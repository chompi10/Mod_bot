/**
 * @file whatsapp/client.ts — WhatsApp API Client (Twilio)
 * 
 * WHY Twilio (not Meta Cloud API directly):
 * 1. Simpler setup — Meta requires business verification (takes days)
 * 2. Sandbox mode — Twilio sandbox works immediately for testing
 * 3. Better docs — Twilio's API documentation is excellent
 * 4. Multi-channel — Can extend to SMS, voice later
 * 
 * TRADEOFF: Twilio adds cost ($0.005/message + WhatsApp fees).
 * For production at scale, Meta Cloud API is cheaper.
 */

import twilio from 'twilio';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { WhatsAppError } from '../utils/errors.js';

const log = createLogger('WhatsAppClient');

const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

export const WhatsAppClient = {
  /**
   * Send a text message to a WhatsApp user.
   * 
   * WHY we split long messages: WhatsApp has a 4096-character limit
   * per message. If the bot's response is longer, we split it into
   * multiple messages to avoid truncation.
   */
  async sendText(to: string, body: string): Promise<void> {
    const MAX_LENGTH = 4000; // Leave buffer for encoding

    try {
      if (body.length <= MAX_LENGTH) {
        await client.messages.create({
          from: config.TWILIO_WHATSAPP_NUMBER,
          to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
          body,
        });
      } else {
        // Split into chunks at sentence boundaries
        const chunks = splitMessage(body, MAX_LENGTH);
        for (const chunk of chunks) {
          await client.messages.create({
            from: config.TWILIO_WHATSAPP_NUMBER,
            to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
            body: chunk,
          });
          // WHY: Small delay between messages to maintain order
          await sleep(500);
        }
      }

      log.debug('Message sent', { to, length: body.length });
    } catch (error) {
      log.error('Failed to send message', { to, error });
      throw new WhatsAppError(`Failed to send message: ${error}`);
    }
  },

  /**
   * Send a media message (image, document, audio).
   */
  async sendMedia(to: string, mediaUrl: string, caption?: string): Promise<void> {
    try {
      await client.messages.create({
        from: config.TWILIO_WHATSAPP_NUMBER,
        to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
        mediaUrl: [mediaUrl],
        body: caption ?? '',
      });
      log.debug('Media sent', { to, mediaUrl });
    } catch (error) {
      log.error('Failed to send media', { to, error });
      throw new WhatsAppError(`Failed to send media: ${error}`);
    }
  },

  /**
   * Send a location message (for sharing hospital/emergency service locations).
   */
  async sendLocation(to: string, lat: number, lng: number, label: string): Promise<void> {
    // WHY: Twilio doesn't support location messages directly via API.
    // We send a Google Maps link instead.
    const mapUrl = `https://maps.google.com/maps?q=${lat},${lng}`;
    await this.sendText(to, `📍 ${label}\n${mapUrl}`);
  },
};

/**
 * Split a long message into chunks at sentence boundaries.
 * WHY sentence boundaries: Splitting mid-sentence creates confusing reads.
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIdx = remaining.lastIndexOf('. ', maxLength);
    if (splitIdx === -1 || splitIdx < maxLength * 0.5) {
      splitIdx = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.5) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx + 1).trim());
    remaining = remaining.slice(splitIdx + 1).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
