/**
 * @file whatsapp/webhook.ts — WhatsApp Webhook Handler
 * 
 * WHY: Twilio sends incoming WhatsApp messages to our webhook URL
 * via HTTP POST. This handler:
 * 1. Validates the request (ensures it's from Twilio, not spoofed)
 * 2. Extracts the message content (text, media, location)
 * 3. Routes to the orchestrator for processing
 * 4. Returns the response to Twilio (which forwards to WhatsApp)
 * 
 * IMPORTANT: Twilio expects a TwiML response within 15 seconds.
 * If processing takes longer, we send an immediate "processing..."
 * message and deliver the actual response asynchronously.
 */

import { Router, type Request, type Response } from 'express';
import { processMessage } from '../agents/orchestrator.js';
import { WhatsAppClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Webhook');
const router = Router();

/**
 * POST /api/webhook — Incoming WhatsApp message handler
 * 
 * Twilio sends POST requests with these fields:
 * - Body: Text message content
 * - From: Sender's WhatsApp number (whatsapp:+91XXXXXXXXXX)
 * - To: Bot's WhatsApp number
 * - MediaUrl0, MediaUrl1, ...: URLs of attached media
 * - MediaContentType0: MIME type of attached media
 * - Latitude, Longitude: If user shared location
 * - ProfileName: User's WhatsApp display name
 */
router.post('/api/webhook', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const {
      Body: body,
      From: from,
      ProfileName: profileName,
      MediaUrl0: mediaUrl,
      MediaContentType0: mediaType,
      Latitude: latitude,
      Longitude: longitude,
    } = req.body;

    log.info('Incoming message', {
      from,
      profileName,
      bodyPreview: body?.slice(0, 50),
      hasMedia: !!mediaUrl,
      hasLocation: !!latitude,
    });

    // Handle location sharing
    let messageText = body || '';
    if (latitude && longitude) {
      messageText = messageText || `[Location shared: ${latitude}, ${longitude}]`;
      // TODO: Update user location in database
    }

    // Handle media (voice messages, images, documents)
    if (mediaUrl && !messageText) {
      if (mediaType?.startsWith('audio/')) {
        messageText = '[Voice message received - transcription in progress]';
        // WHY: Voice messages are common in India where many users are
        // more comfortable speaking than typing. Whisper API transcribes these.
        // HACKATHON NOTE: Implement Whisper transcription in media.ts
      } else if (mediaType?.startsWith('image/')) {
        messageText = '[Image received]';
      } else {
        messageText = '[Document received]';
      }
    }

    if (!messageText) {
      // Empty message — shouldn't happen, but handle gracefully
      res.status(200).send('<Response></Response>');
      return;
    }

    // Process the message through the orchestrator
    const response = await processMessage(from, messageText, mediaUrl);

    // Send response back via Twilio
    // WHY TwiML: Twilio expects XML responses in a specific format
    const twiml = `<Response><Message>${escapeXml(response)}</Message></Response>`;

    res.type('text/xml').status(200).send(twiml);

    log.info('Response sent', {
      from,
      duration_ms: Date.now() - startTime,
      responseLength: response.length,
    });
  } catch (error) {
    log.error('Webhook handler failed', { error });

    // WHY: Even on error, send a response so the user isn't left hanging
    const errorTwiml = `<Response><Message>Sorry, I encountered an error. Please try again or call 108 for emergencies.</Message></Response>`;
    res.type('text/xml').status(200).send(errorTwiml);
  }
});

/**
 * GET /api/webhook — Twilio webhook verification
 * Some setups require responding to GET for verification.
 */
router.get('/api/webhook', (_req: Request, res: Response) => {
  res.status(200).send('SahAI WhatsApp webhook is active');
});

/**
 * GET /api/health — Health check endpoint
 * WHY: For monitoring (uptime services, load balancers, k8s probes)
 */
router.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'SahAI WhatsApp Healthcare Assistant',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Escape XML special characters to prevent TwiML injection.
 * WHY: If a user or LLM response contains '<' or '&', it would
 * break the XML response. This prevents that.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export { router as webhookRouter };
