/**
 * @file mcp-tools/healthcare/index.ts — Healthcare MCP Tools
 * 
 * WHY SEPARATE TOOLS (not one big "health" tool):
 * Each tool has a single responsibility. This lets the LLM compose
 * them intelligently. For example:
 * - "I have chest pain" → symptom_analyzer (urgency: emergency)
 * - "Find me a hospital" → hospital_finder
 * - "Book with Dr. X" → appointment_booker
 * 
 * The LLM decides which tools to call and in what order. This is
 * more flexible than hardcoded flows.
 * 
 * MEDICAL DISCLAIMER: These tools provide INFORMATIONAL content only.
 * They are NOT a substitute for professional medical advice.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ToolRegistry } from '../registry.js';
import { HealthRepo } from '../../db/client.js';
import { HeartbeatManager, type ScheduledReminder } from '../../memory/heartbeat.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('HealthcareTools');

// ─── 1. Symptom Analyzer ───────────────────────────────────────
/**
 * WHY: The core health triage tool. Takes a natural language symptom
 * description and returns urgency classification + recommendations.
 * 
 * HACKATHON NOTE: In production, this would query a medical knowledge
 * base (e.g., Mayo Clinic API, WHO ICD-11 database). For the hackathon,
 * we use a rule-based system with common symptom patterns.
 */
ToolRegistry.register(
  {
    name: 'symptom_analyzer',
    description: 'Analyze symptoms described in natural language. Returns urgency level (emergency/urgent/routine), recommended specialty, and immediate advice. ALWAYS include medical disclaimer.',
    input_schema: {
      type: 'object',
      properties: {
        symptoms: {
          type: 'string',
          description: 'Natural language description of symptoms (e.g., "I have a severe headache and fever for 3 days")',
        },
        duration: {
          type: 'string',
          description: 'How long symptoms have persisted (e.g., "3 days", "since morning")',
        },
        severity: {
          type: 'string',
          description: 'Self-reported severity: mild, moderate, severe',
          enum: ['mild', 'moderate', 'severe'],
        },
        user_id: {
          type: 'string',
          description: 'User ID to check against medical history',
        },
      },
      required: ['symptoms'],
    },
  },
  async (args) => {
    const { symptoms, duration, severity, user_id } = args as {
      symptoms: string;
      duration?: string;
      severity?: string;
      user_id?: string;
    };

    // Check user's medical history for relevant context
    let medicalContext = '';
    if (user_id) {
      const record = HealthRepo.getOrCreate(user_id);
      if (record.allergies.length > 0) {
        medicalContext += `Known allergies: ${record.allergies.join(', ')}. `;
      }
      if (record.medical_history.length > 0) {
        medicalContext += `Medical history: ${record.medical_history.join(', ')}. `;
      }
    }

    // Rule-based triage (simplified for hackathon)
    const analysis = triageSymptoms(symptoms, severity ?? 'moderate');

    return {
      urgency: analysis.urgency,
      confidence: analysis.confidence,
      recommended_specialty: analysis.specialty,
      symptoms_identified: analysis.keywords,
      immediate_advice: analysis.advice,
      medical_context: medicalContext || 'No prior medical history on file.',
      disclaimer: '⚕️ This is AI-generated health information, NOT a medical diagnosis. Please consult a qualified healthcare professional for proper evaluation and treatment.',
    };
  },
  z.object({
    symptoms: z.string().min(3),
    duration: z.string().optional(),
    severity: z.enum(['mild', 'moderate', 'severe']).optional(),
    user_id: z.string().optional(),
  })
);

// ─── 2. Hospital Finder ────────────────────────────────────────
ToolRegistry.register(
  {
    name: 'hospital_finder',
    description: 'Find nearby hospitals or clinics with specific specialties. Returns list of hospitals with distance, specialties, and contact info.',
    input_schema: {
      type: 'object',
      properties: {
        specialty: {
          type: 'string',
          description: 'Medical specialty needed (e.g., "cardiology", "orthopedics", "general")',
        },
        latitude: { type: 'string', description: 'User latitude' },
        longitude: { type: 'string', description: 'User longitude' },
        emergency: { type: 'string', description: 'Is this an emergency? "true" or "false"' },
      },
      required: ['specialty'],
    },
  },
  async (args) => {
    const { specialty, latitude, longitude, emergency } = args as Record<string, string>;

    // HACKATHON NOTE: In production, this would call Google Maps Places API
    // or a hospital directory API. For demo, we return mock data for Chennai.
    const hospitals = getMockHospitals(specialty, emergency === 'true');

    return {
      hospitals,
      search_specialty: specialty,
      result_count: hospitals.length,
      note: 'Distances are approximate. Call ahead to confirm availability.',
    };
  },
  z.object({
    specialty: z.string(),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
    emergency: z.string().optional(),
  })
);

// ─── 3. Appointment Booker ──────────────────────────────────────
ToolRegistry.register(
  {
    name: 'appointment_booker',
    description: 'Book a hospital appointment. Returns confirmation details.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User WhatsApp ID' },
        hospital_name: { type: 'string', description: 'Name of the hospital' },
        doctor_name: { type: 'string', description: 'Name of the doctor' },
        specialty: { type: 'string', description: 'Medical specialty' },
        preferred_date: { type: 'string', description: 'Preferred date (YYYY-MM-DD)' },
        preferred_time: { type: 'string', description: 'Preferred time slot (morning/afternoon/evening)' },
      },
      required: ['user_id', 'hospital_name', 'specialty'],
    },
  },
  async (args) => {
    const { user_id, hospital_name, doctor_name, specialty, preferred_date, preferred_time } = args as Record<string, string>;

    // HACKATHON NOTE: In production, this would call the hospital's booking API
    const appointmentId = uuidv4().slice(0, 8).toUpperCase();
    const date = preferred_date || new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const time = preferred_time === 'morning' ? '10:00 AM' : preferred_time === 'evening' ? '4:00 PM' : '2:00 PM';

    // Save to health records
    if (user_id) {
      const record = HealthRepo.getOrCreate(user_id);
      const appointment = {
        id: appointmentId,
        hospital_name,
        doctor_name: doctor_name || 'To be assigned',
        specialty,
        date: new Date(`${date}T${time.replace(' AM', ':00').replace(' PM', ':00')}`),
        status: 'scheduled' as const,
      };
      record.appointments.push(appointment);
      HealthRepo.update(user_id, { appointments: record.appointments });
    }

    return {
      confirmation_id: appointmentId,
      hospital: hospital_name,
      doctor: doctor_name || 'Will be assigned on arrival',
      specialty,
      date,
      time,
      status: 'confirmed',
      instructions: 'Please bring your ID proof and any relevant medical records. Arrive 15 minutes early.',
    };
  },
  z.object({
    user_id: z.string(),
    hospital_name: z.string(),
    doctor_name: z.string().optional(),
    specialty: z.string(),
    preferred_date: z.string().optional(),
    preferred_time: z.string().optional(),
  })
);

// ─── 4. Medication Reminder ─────────────────────────────────────
ToolRegistry.register(
  {
    name: 'medication_reminder',
    description: 'Schedule medication reminders via WhatsApp. Sends messages at specified times.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User WhatsApp ID' },
        medication_name: { type: 'string', description: 'Name of the medication' },
        dosage: { type: 'string', description: 'Dosage (e.g., "500mg")' },
        frequency: { type: 'string', description: 'How often (e.g., "8h" for every 8 hours, "12h", "24h")' },
        action: { type: 'string', description: '"add" to create or "remove" to delete a reminder', enum: ['add', 'remove'] },
      },
      required: ['user_id', 'medication_name', 'action'],
    },
  },
  async (args) => {
    const { user_id, medication_name, dosage, frequency, action } = args as Record<string, string>;

    if (action === 'add') {
      const reminder: ScheduledReminder = {
        id: uuidv4(),
        type: 'medication',
        message: `💊 Medication Reminder: Time to take ${medication_name}${dosage ? ` (${dosage})` : ''}. Stay healthy! 🏥`,
        schedule: frequency || '12h',
        recurring: true,
      };

      HeartbeatManager.addReminder(user_id, reminder);

      return {
        status: 'scheduled',
        reminder_id: reminder.id,
        medication: medication_name,
        dosage: dosage || 'as prescribed',
        frequency: frequency || 'every 12 hours',
        message: `Reminder set! I'll remind you to take ${medication_name} every ${frequency || '12 hours'}.`,
      };
    } else {
      const reminders = HeartbeatManager.getReminders(user_id);
      const found = reminders.find((r) => r.message.includes(medication_name));
      if (found) {
        HeartbeatManager.removeReminder(user_id, found.id);
        return { status: 'removed', medication: medication_name };
      }
      return { status: 'not_found', medication: medication_name };
    }
  },
  z.object({
    user_id: z.string(),
    medication_name: z.string(),
    dosage: z.string().optional(),
    frequency: z.string().optional(),
    action: z.enum(['add', 'remove']),
  })
);

// ─── 5. Health Record Manager ───────────────────────────────────
ToolRegistry.register(
  {
    name: 'health_record_manager',
    description: 'Store or retrieve health history. Can add allergies, medical conditions, medications, or retrieve the full health profile.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User WhatsApp ID' },
        action: { type: 'string', description: '"get" to retrieve or "update" to modify', enum: ['get', 'update'] },
        field: { type: 'string', description: 'Field to update: allergies, medical_history, vitals', enum: ['allergies', 'medical_history', 'vitals', 'current_medications'] },
        value: { type: 'string', description: 'Value to add (for update action)' },
      },
      required: ['user_id', 'action'],
    },
  },
  async (args) => {
    const { user_id, action, field, value } = args as Record<string, string>;

    const record = HealthRepo.getOrCreate(user_id);

    if (action === 'get') {
      return {
        medical_history: record.medical_history,
        allergies: record.allergies,
        current_medications: record.current_medications,
        vitals: record.vitals,
        upcoming_appointments: record.appointments.filter((a) => a.status === 'scheduled'),
        last_updated: record.last_updated,
      };
    }

    // Update action
    if (field && value) {
      if (field === 'allergies') {
        record.allergies.push(value);
        HealthRepo.update(user_id, { allergies: record.allergies });
      } else if (field === 'medical_history') {
        record.medical_history.push(value);
        HealthRepo.update(user_id, { medical_history: record.medical_history });
      } else if (field === 'vitals') {
        const [key, val] = value.split(':');
        if (key && val) record.vitals[key.trim()] = val.trim();
        HealthRepo.update(user_id, { vitals: record.vitals });
      }
      return { status: 'updated', field, value };
    }

    return { status: 'error', message: 'Field and value required for update action' };
  },
  z.object({
    user_id: z.string(),
    action: z.enum(['get', 'update']),
    field: z.string().optional(),
    value: z.string().optional(),
  })
);

// ─── Helper: Symptom Triage Engine ──────────────────────────────
/**
 * Rule-based symptom triage.
 * 
 * WHY rules-based (not pure LLM):
 * Safety-critical decisions shouldn't depend solely on an LLM's
 * probabilistic output. Rules ensure that known emergency symptoms
 * ALWAYS trigger emergency classification, regardless of how the
 * LLM interprets the text.
 * 
 * The LLM is used for nuance; the rules are the safety net.
 */
function triageSymptoms(symptoms: string, severity: string) {
  const lower = symptoms.toLowerCase();

  // EMERGENCY keywords — these ALWAYS trigger emergency classification
  const emergencyKeywords = [
    'chest pain', 'can\'t breathe', 'breathing difficulty', 'unconscious',
    'heavy bleeding', 'seizure', 'stroke', 'heart attack', 'poisoning',
    'suicide', 'self harm', 'overdose', 'severe burn', 'snake bite',
    'மார்பு வலி', 'மூச்சு திணறல்',  // Tamil: chest pain, breathing difficulty
    'सीने में दर्द', 'सांस नहीं',  // Hindi: chest pain, can't breathe
  ];

  const urgentKeywords = [
    'high fever', 'broken bone', 'severe pain', 'blood in', 'concussion',
    'allergic reaction', 'dehydration', 'persistent vomiting', 'infection',
  ];

  // Check emergency first (highest priority)
  const isEmergency = emergencyKeywords.some((kw) => lower.includes(kw)) || severity === 'severe';
  const isUrgent = urgentKeywords.some((kw) => lower.includes(kw));

  // Determine specialty based on symptoms
  const specialty = determineSpecialty(lower);

  // Extract identified symptom keywords
  const allKeywords = [...emergencyKeywords, ...urgentKeywords];
  const found = allKeywords.filter((kw) => lower.includes(kw));

  if (isEmergency) {
    return {
      urgency: 'emergency' as const,
      confidence: 0.9,
      specialty: specialty || 'Emergency Medicine',
      keywords: found,
      advice: '🚨 This appears to be a medical emergency. Please call 108 (ambulance) immediately or go to the nearest emergency room. Do not delay seeking help.',
    };
  }

  if (isUrgent) {
    return {
      urgency: 'urgent' as const,
      confidence: 0.75,
      specialty: specialty || 'General Medicine',
      keywords: found,
      advice: '⚠️ These symptoms need prompt medical attention. I recommend seeing a doctor within 24 hours. If symptoms worsen, go to an emergency room.',
    };
  }

  return {
    urgency: 'routine' as const,
    confidence: 0.65,
    specialty: specialty || 'General Medicine',
    keywords: found.length > 0 ? found : [symptoms.split(' ').slice(0, 3).join(' ')],
    advice: 'Based on your symptoms, this appears to be a non-emergency. I can help you book an appointment with a suitable specialist.',
  };
}

function determineSpecialty(symptoms: string): string {
  const specialtyMap: Record<string, string[]> = {
    'Cardiology': ['chest', 'heart', 'palpitation', 'blood pressure'],
    'Neurology': ['headache', 'migraine', 'dizziness', 'seizure', 'numbness'],
    'Orthopedics': ['bone', 'joint', 'back pain', 'fracture', 'sprain'],
    'Dermatology': ['skin', 'rash', 'itching', 'acne', 'eczema'],
    'Gastroenterology': ['stomach', 'digestion', 'nausea', 'vomiting', 'diarrhea'],
    'Pulmonology': ['cough', 'breathing', 'asthma', 'lung', 'wheeze'],
    'ENT': ['ear', 'throat', 'nose', 'sinus', 'hearing'],
    'Ophthalmology': ['eye', 'vision', 'blurry'],
    'Pediatrics': ['child', 'baby', 'infant', 'toddler'],
    'Gynecology': ['period', 'pregnancy', 'menstrual'],
  };

  for (const [specialty, keywords] of Object.entries(specialtyMap)) {
    if (keywords.some((kw) => symptoms.includes(kw))) {
      return specialty;
    }
  }
  return 'General Medicine';
}

// ─── Helper: Mock Hospital Data ─────────────────────────────────
function getMockHospitals(specialty: string, isEmergency: boolean) {
  // HACKATHON NOTE: Replace with Google Maps Places API call
  const hospitals = [
    {
      name: 'Apollo Hospital, Greams Road',
      specialty: ['Multi-specialty', 'Cardiology', 'Neurology', 'Emergency Medicine'],
      distance_km: 2.5,
      phone: '+91-44-28290200',
      emergency_24x7: true,
      rating: 4.3,
    },
    {
      name: 'MIOT International Hospital',
      specialty: ['Multi-specialty', 'Orthopedics', 'Cardiology', 'Emergency Medicine'],
      distance_km: 4.1,
      phone: '+91-44-42002288',
      emergency_24x7: true,
      rating: 4.2,
    },
    {
      name: 'Government General Hospital',
      specialty: ['General Medicine', 'Emergency Medicine', 'All Specialties'],
      distance_km: 3.0,
      phone: '+91-44-25305000',
      emergency_24x7: true,
      rating: 3.8,
      note: 'Free treatment under government schemes',
    },
    {
      name: 'Fortis Malar Hospital',
      specialty: ['Cardiology', 'Gastroenterology', 'Neurology'],
      distance_km: 5.2,
      phone: '+91-44-42892222',
      emergency_24x7: true,
      rating: 4.1,
    },
    {
      name: 'Kauvery Hospital',
      specialty: ['General Medicine', 'Pediatrics', 'Dermatology'],
      distance_km: 3.7,
      phone: '+91-44-40006000',
      emergency_24x7: true,
      rating: 4.0,
    },
  ];

  // Filter by specialty relevance and sort by distance
  return hospitals
    .filter((h) =>
      isEmergency
        ? h.emergency_24x7
        : h.specialty.some((s) => s.toLowerCase().includes(specialty.toLowerCase()) || s === 'Multi-specialty')
    )
    .sort((a, b) => a.distance_km - b.distance_km);
}

log.info('Healthcare tools registered', { count: 5 });
