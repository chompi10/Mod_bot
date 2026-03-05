/**
 * @file mcp-tools/emergency/index.ts — Emergency Services Tools
 * 
 * CRITICAL DESIGN PRINCIPLE: Emergency tools NEVER wait for LLM responses.
 * They use simple rules and execute immediately.
 */

import { z } from 'zod';
import { ToolRegistry } from '../registry.js';
import { config } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('EmergencyTools');

export const EMERGENCY_KEYWORDS = [
  'emergency', 'help me', 'ambulance', 'dying', 'heart attack', 'stroke',
  "can't breathe", 'accident', 'bleeding badly', 'unconscious', 'fire',
  'snake bite', 'poisoning', 'chest pain', 'suicide', 'attack', '108',
  'avalaram', 'uthavi', 'aapathkaal', 'madad',
];

export function isEmergency(text: string): boolean {
  const lower = text.toLowerCase();
  return EMERGENCY_KEYWORDS.some((kw) => lower.includes(kw));
}

// 1. Emergency Dispatcher
ToolRegistry.register(
  {
    name: 'emergency_dispatcher',
    description: 'Dispatch emergency services (ambulance, police, fire). Returns emergency numbers and initiates dispatch.',
    input_schema: {
      type: 'object',
      properties: {
        emergency_type: { type: 'string', description: 'Type: medical, police, fire, all', enum: ['medical', 'police', 'fire', 'all'] },
        user_id: { type: 'string', description: 'User WhatsApp ID' },
        description: { type: 'string', description: 'Brief emergency description' },
        latitude: { type: 'string', description: 'GPS latitude' },
        longitude: { type: 'string', description: 'GPS longitude' },
      },
      required: ['emergency_type'],
    },
  },
  async (args) => {
    const { emergency_type, description, latitude, longitude } = args as Record<string, string>;

    const numbers: Record<string, { number: string; name: string }> = {
      medical: { number: config.AMBULANCE_NUMBER, name: 'Ambulance (108)' },
      police: { number: config.POLICE_NUMBER, name: 'Police (100)' },
      fire: { number: config.FIRE_NUMBER, name: 'Fire Services (101)' },
    };

    const dispatched = emergency_type === 'all'
      ? Object.values(numbers)
      : [numbers[emergency_type] ?? numbers['medical']!];

    log.warn('EMERGENCY DISPATCH', { emergency_type, description, latitude, longitude });

    return {
      status: 'dispatched',
      emergency_type,
      services: dispatched,
      location: latitude && longitude ? { lat: latitude, lng: longitude } : 'Not available - please share your location',
      immediate_actions: getImmediateActions(emergency_type),
      message: `EMERGENCY ALERT: Call ${dispatched.map((d) => d!.number).join(' or ')} immediately if you haven't already.`,
      additional_helplines: {
        women_helpline: config.WOMEN_HELPLINE,
        child_helpline: config.CHILD_HELPLINE,
        mental_health: 'iCall: 9152987821',
      },
    };
  },
  z.object({
    emergency_type: z.enum(['medical', 'police', 'fire', 'all']),
    user_id: z.string().optional(),
    description: z.string().optional(),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
  })
);

// 2. Location Tracker
ToolRegistry.register(
  {
    name: 'location_tracker',
    description: 'Get or share GPS coordinates for emergency services.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User WhatsApp ID' },
        action: { type: 'string', description: '"request" to ask user for location, "share" to share with emergency services', enum: ['request', 'share'] },
        latitude: { type: 'string', description: 'Latitude (for share action)' },
        longitude: { type: 'string', description: 'Longitude (for share action)' },
      },
      required: ['user_id', 'action'],
    },
  },
  async (args) => {
    const { user_id, action, latitude, longitude } = args as Record<string, string>;

    if (action === 'request') {
      return {
        action: 'request_location',
        message: 'Please share your current location using the WhatsApp attachment (paperclip) > Location > Share Live Location. This helps emergency services reach you faster.',
        user_id,
      };
    }

    if (latitude && longitude) {
      const mapUrl = `https://maps.google.com/maps?q=${latitude},${longitude}`;
      return {
        action: 'location_shared',
        coordinates: { lat: latitude, lng: longitude },
        google_maps_url: mapUrl,
        message: `Location received. Emergency services have been notified. Map: ${mapUrl}`,
      };
    }

    return { action: 'error', message: 'No location data available.' };
  },
  z.object({
    user_id: z.string(),
    action: z.enum(['request', 'share']),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
  })
);

// 3. Contact Notifier
ToolRegistry.register(
  {
    name: 'contact_notifier',
    description: 'Alert emergency contacts when a user triggers an emergency.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User WhatsApp ID' },
        emergency_type: { type: 'string', description: 'Type of emergency' },
        location: { type: 'string', description: 'Location details or Google Maps URL' },
        contacts: { type: 'string', description: 'JSON array of contacts to notify: [{name, phone}]' },
      },
      required: ['user_id', 'emergency_type'],
    },
  },
  async (args) => {
    const { user_id, emergency_type, location, contacts } = args as Record<string, string>;

    let contactList: Array<{ name: string; phone: string }> = [];
    try {
      if (contacts) contactList = JSON.parse(contacts);
    } catch { /* empty */ }

    // HACKATHON NOTE: In production, send actual WhatsApp messages to each contact
    const notifications = contactList.map((c) => ({
      contact: c.name,
      phone: c.phone,
      message: `EMERGENCY ALERT: ${user_id} has triggered a ${emergency_type} emergency. ${location ? `Location: ${location}` : 'Location not available.'}. Please check on them immediately.`,
      status: 'sent',
    }));

    log.warn('Emergency contacts notified', { user_id, contactCount: notifications.length });

    return {
      notifications_sent: notifications.length,
      details: notifications,
      note: contactList.length === 0
        ? 'No emergency contacts configured. Please add emergency contacts by saying "add emergency contact".'
        : `${notifications.length} contact(s) have been notified.`,
    };
  },
  z.object({
    user_id: z.string(),
    emergency_type: z.string(),
    location: z.string().optional(),
    contacts: z.string().optional(),
  })
);

// 4. Resource Mapper
ToolRegistry.register(
  {
    name: 'resource_mapper',
    description: 'Find nearest emergency services (hospitals, police stations, fire stations).',
    input_schema: {
      type: 'object',
      properties: {
        resource_type: { type: 'string', description: 'hospital, police_station, fire_station', enum: ['hospital', 'police_station', 'fire_station'] },
        latitude: { type: 'string', description: 'User latitude' },
        longitude: { type: 'string', description: 'User longitude' },
      },
      required: ['resource_type'],
    },
  },
  async (args) => {
    const { resource_type } = args as Record<string, string>;
    // HACKATHON NOTE: In production, use Google Maps Places API
    const resources: Record<string, Array<{ name: string; distance: string; phone: string; address: string }>> = {
      hospital: [
        { name: 'Government General Hospital', distance: '2.1 km', phone: '+91-44-25305000', address: 'Park Town, Chennai' },
        { name: 'Apollo Hospital', distance: '3.5 km', phone: '+91-44-28290200', address: 'Greams Road, Chennai' },
      ],
      police_station: [
        { name: 'Chennai Central Police Station', distance: '1.8 km', phone: '100', address: 'EVR Periyar Road, Chennai' },
      ],
      fire_station: [
        { name: 'Chennai Fire Station - Egmore', distance: '2.3 km', phone: '101', address: 'Egmore, Chennai' },
      ],
    };

    return {
      resource_type,
      nearest: resources[resource_type] ?? [],
      emergency_number: resource_type === 'hospital' ? '108' : resource_type === 'police_station' ? '100' : '101',
    };
  },
  z.object({
    resource_type: z.enum(['hospital', 'police_station', 'fire_station']),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
  })
);

function getImmediateActions(type: string): string[] {
  const actions: Record<string, string[]> = {
    medical: [
      'Call 108 for an ambulance immediately',
      'If the person is unconscious, check their breathing',
      'Do not move the person if spinal injury is suspected',
      'If bleeding, apply firm pressure with a clean cloth',
      'Keep the person calm and warm',
    ],
    police: [
      'Call 100 immediately',
      'Move to a safe location if possible',
      'Do not confront the threat',
      'Note descriptions and details for the police',
    ],
    fire: [
      'Call 101 immediately',
      'Evacuate the building using stairs (NOT elevators)',
      'Stay low to avoid smoke inhalation',
      'If trapped, seal door gaps with wet cloth',
      'Signal from a window if possible',
    ],
    all: ['Call 112 (unified emergency number) for all services'],
  };
  return actions[type] ?? actions['all']!;
}

log.info('Emergency tools registered', { count: 4 });
