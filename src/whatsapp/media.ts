/**
 * @file whatsapp/media.ts — Media Handling (Voice/Image/Document)
 * 
 * WHY: In India, voice messages are extremely popular — many users
 * prefer speaking over typing, especially in rural areas or among
 * older populations. Images are also common (sharing prescriptions,
 * medical reports, skin conditions).
 * 
 * This module handles:
 * 1. Voice → Text (via OpenAI Whisper)
 * 2. Image → Description (via GPT-4o Vision)  
 * 3. Document → Text extraction
 */

import OpenAI from 'openai';
import axios from 'axios';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('MediaHandler');
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

export const MediaHandler = {
  /**
   * Transcribe a voice message using OpenAI Whisper.
   * 
   * WHY Whisper:
   * - Supports Tamil, Hindi, and English natively
   * - Handles code-switching (mixing languages) well
   * - Works with noisy audio (WhatsApp voice messages are often recorded in noisy environments)
   * 
   * HACKATHON NOTE: Twilio provides a URL to the audio file.
   * We download it and send it to Whisper. In production, use
   * a streaming approach to reduce latency.
   */
  async transcribeVoice(audioUrl: string): Promise<string> {
    try {
      // Download the audio file from Twilio
      const audioResponse = await axios.get(audioUrl, {
        responseType: 'arraybuffer',
        auth: {
          username: config.TWILIO_ACCOUNT_SID,
          password: config.TWILIO_AUTH_TOKEN,
        },
      });

      // Create a File-like object for the OpenAI API
      const audioBuffer = Buffer.from(audioResponse.data);
      const file = new File([audioBuffer], 'voice.ogg', { type: 'audio/ogg' });

      const transcription = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        language: undefined, // Auto-detect language
      });

      log.info('Voice transcribed', {
        textLength: transcription.text.length,
        preview: transcription.text.slice(0, 50),
      });

      return transcription.text;
    } catch (error) {
      log.error('Voice transcription failed', { error, audioUrl });
      return '[Voice message could not be transcribed. Please type your message.]';
    }
  },

  /**
   * Analyze an image using GPT-4o Vision.
   * 
   * USE CASES:
   * - Prescription photos → Extract medication names and dosages
   * - Skin condition photos → Describe for triage (NOT diagnose)
   * - Medical report photos → Extract key values (blood sugar, BP, etc.)
   * - Document photos → Extract text for scheme applications
   */
  async analyzeImage(imageUrl: string, context: string = 'health'): Promise<string> {
    try {
      const prompts: Record<string, string> = {
        health: 'Describe this medical image. If it is a prescription, list the medications and dosages. If it shows a medical condition, describe what you observe without diagnosing. If it is a medical report, extract key values.',
        document: 'Extract all text from this document image. Preserve the structure and formatting.',
        general: 'Describe this image in detail.',
      };

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompts[context] ?? prompts['general']! },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 500,
      });

      return response.choices[0]?.message?.content ?? 'Unable to analyze the image.';
    } catch (error) {
      log.error('Image analysis failed', { error });
      return '[Image could not be analyzed. Please describe what you see.]';
    }
  },
};
