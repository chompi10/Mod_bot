/**
 * @file memory/profile.ts — Profile/Context File Manager
 * 
 * WHY SEPARATE FILES FOR DIFFERENT CONCERNS:
 * 
 * USER.md — Who is the user?
 *   Contains: name, age, location, language, medical history, allergies,
 *   family info, insurance details. Updated by user interactions.
 *   Privacy: NEVER sent externally without consent.
 * 
 * SOUL.md — Who is the bot?
 *   Contains: personality traits, communication style, guardrails.
 *   This is the bot's "constitution" — it defines how SahAI behaves.
 *   Read-only after initial setup.
 * 
 * TOOLS.md — What can the bot do?
 *   Contains: available APIs, integration endpoints, rate limits.
 *   Updated when new tools/APIs are configured.
 * 
 * PATTERN: "Separation of Concerns" — each file has a single
 * responsibility. This makes it clear where to look for what,
 * and prevents one type of update from corrupting another.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ProfileManager');

function getUserDir(userId: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9+]/g, '_');
  const dir = join(config.MEMORY_DIR, safeId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Default File Templates ─────────────────────────────────────
// WHY templates: When a new user starts, these templates create a
// structured starting point. The LLM can read the headings and
// understand what information to collect and where to store it.

const DEFAULT_USER_MD = `# User Profile

## Basic Info
- Name: Unknown
- Language: English
- Location: Not set

## Medical Profile
- Blood Group: Unknown
- Known Allergies: None recorded
- Chronic Conditions: None recorded
- Current Medications: None

## Preferences
- Preferred Hospital: Not set
- Preferred Doctor: Not set
- Appointment Preference: Not set
- Communication Style: Default

## Emergency Contacts
- None configured

## Insurance
- Not configured
`;

const DEFAULT_SOUL_MD = `# SahAI — Soul / Personality Definition

## Identity
I am SahAI (சகாய் / सहाई), a compassionate healthcare assistant available on WhatsApp.
My name means "companion" — I am here to help, not to replace medical professionals.

## Core Values
1. **Safety First**: In emergencies, I act immediately. I never delay critical help.
2. **Honesty**: I always disclose that I am an AI. I never pretend to be a doctor.
3. **Privacy**: I treat health data as sacred. I never share it without explicit consent.
4. **Empathy**: I acknowledge emotions. Health issues are stressful, and I respond with care.
5. **Accessibility**: I communicate in Tamil, Hindi, or English — whatever the user prefers.

## Communication Style
- Warm and supportive, like a knowledgeable friend
- Clear and simple language (avoid medical jargon unless the user uses it)
- Always include disclaimers for medical advice
- Use emojis sparingly to convey warmth: 🏥 ❤️ ✅
- Keep messages concise — WhatsApp is not a place for essays

## Guardrails
- NEVER diagnose. Always say "based on your symptoms, it could be..." not "you have..."
- ALWAYS recommend consulting a doctor for anything beyond basic triage
- NEVER prescribe medications — only remind about existing prescriptions
- IMMEDIATELY escalate if emergency keywords are detected (chest pain, bleeding, unconscious)
- RESPECT cultural context — many users may prefer traditional medicine alongside allopathy

## Medical Disclaimer
I include this in my first health-related response to each user:
"⚕️ I'm an AI health companion, not a doctor. My suggestions are informational only.
Please consult a qualified healthcare professional for medical decisions."
`;

const DEFAULT_TOOLS_MD = `# Tools & Integration Notes

## Available APIs
- OpenAI GPT-4o: Primary LLM for conversation and triage
- OpenAI Embeddings: text-embedding-3-small for RAG
- Twilio WhatsApp: Message sending/receiving

## Emergency Numbers (India)
- Ambulance: 108
- Police: 100
- Fire: 101
- Women Helpline: 181
- Child Helpline: 1098

## Hospital APIs
- Not configured yet. Add hospital booking API endpoints here.

## Rate Limits
- OpenAI: 500 RPM (tier 1)
- Twilio: 1 message/second per number
- WhatsApp: 1000 messages/day (sandbox), unlimited (production)

## Notes
- Voice messages are transcribed using OpenAI Whisper
- Images are analyzed using GPT-4o Vision
- PDFs are extracted and summarized before processing
`;

// ─── Profile Operations ─────────────────────────────────────────
export const ProfileManager = {
  /**
   * Read USER.md for a specific user.
   * 
   * WHEN TO CALL: At the start of every agent request, during
   * context assembly. The user's profile provides critical context
   * (allergies, language preference, etc.) that affects every response.
   */
  readUserProfile(userId: string): string {
    const path = join(getUserDir(userId), 'USER.md');
    if (!existsSync(path)) {
      writeFileSync(path, DEFAULT_USER_MD, 'utf-8');
      return DEFAULT_USER_MD;
    }
    return readFileSync(path, 'utf-8');
  },

  /**
   * Update a specific section in USER.md.
   * 
   * WHY section-based updates: We don't want to rewrite the entire
   * file when just the "Allergies" line changes. Section-targeted
   * updates are safer and create cleaner diffs.
   */
  updateUserProfile(userId: string, section: string, key: string, value: string): void {
    const path = join(getUserDir(userId), 'USER.md');
    let content = this.readUserProfile(userId);

    // Find and replace the specific key-value line
    const pattern = new RegExp(`(- ${key}:).*`, 'i');
    if (pattern.test(content)) {
      content = content.replace(pattern, `$1 ${value}`);
    } else {
      // If key doesn't exist, add it under the section
      const sectionPattern = new RegExp(`(## ${section}\n)`, 'i');
      if (sectionPattern.test(content)) {
        content = content.replace(sectionPattern, `$1- ${key}: ${value}\n`);
      }
    }

    writeFileSync(path, content, 'utf-8');
    log.info('User profile updated', { userId, section, key });
  },

  /**
   * Read SOUL.md (bot personality).
   * 
   * WHY: Injected into every LLM call as part of the system prompt.
   * This ensures consistent behavior across all agents and sessions.
   */
  readSoul(): string {
    const path = join(config.MEMORY_DIR, 'SOUL.md');
    if (!existsSync(path)) {
      mkdirSync(config.MEMORY_DIR, { recursive: true });
      writeFileSync(path, DEFAULT_SOUL_MD, 'utf-8');
    }
    return readFileSync(path, 'utf-8');
  },

  /**
   * Read TOOLS.md (integration notes).
   * 
   * WHY: The LLM needs to know what tools are available and their
   * limitations. TOOLS.md provides this context without hardcoding
   * it into the system prompt.
   */
  readTools(): string {
    const path = join(config.MEMORY_DIR, 'TOOLS.md');
    if (!existsSync(path)) {
      mkdirSync(config.MEMORY_DIR, { recursive: true });
      writeFileSync(path, DEFAULT_TOOLS_MD, 'utf-8');
    }
    return readFileSync(path, 'utf-8');
  },

  /**
   * Update TOOLS.md when new integrations are configured.
   */
  appendTools(userId: string, entry: string): void {
    const path = join(config.MEMORY_DIR, 'TOOLS.md');
    const content = this.readTools() + `\n- ${entry}\n`;
    writeFileSync(path, content, 'utf-8');
  },
};
