/**
 * @file utils/language.ts — Language Detection & Translation
 * 
 * WHY: SahAI serves users in Tamil Nadu, India where people commonly
 * switch between Tamil, Hindi, and English — often within the same message
 * (code-switching). We need to:
 * 1. Detect the dominant language of incoming messages
 * 2. Respond in the same language the user writes in
 * 3. Translate system-generated content (e.g., emergency instructions)
 * 
 * TRADEOFF: For the hackathon, we use the 'franc' library for detection
 * and OpenAI for translation. In production, Google Cloud Translation API
 * would be more accurate and support more scripts.
 * 
 * HACKATHON NOTE: franc works well for full sentences but struggles with
 * short messages (< 10 chars). For those, we fall back to 'english'.
 */

import { createLogger } from './logger.js';

const log = createLogger('Language');

// ─── Supported Languages ────────────────────────────────────────
export type SupportedLanguage = 'english' | 'tamil' | 'hindi';

// WHY: franc returns ISO 639-3 codes. We map them to our internal names.
const FRANC_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  eng: 'english',
  tam: 'tamil',
  hin: 'hindi',
};

/**
 * Detect the language of a text message.
 * 
 * WHY: We detect language per-message rather than per-user because
 * multilingual users frequently switch languages mid-conversation.
 * This ensures the bot always mirrors the user's current language.
 * 
 * HACKATHON NOTE: Using simple heuristics + franc. In production,
 * use Google Cloud Translation API's detectLanguage endpoint.
 */
export async function detectLanguage(text: string): Promise<SupportedLanguage> {
  // Short messages are unreliable for detection — check script manually
  if (text.length < 10) {
    return detectByScript(text);
  }

  try {
    // WHY: Dynamic import because franc is ESM-only
    const { franc } = await import('franc');
    const detected = franc(text, {
      only: ['eng', 'tam', 'hin'],  // Restrict to our supported set
      minLength: 5,
    });

    const language = FRANC_TO_LANGUAGE[detected];
    if (language) {
      log.debug(`Detected language: ${language}`, { text: text.slice(0, 50) });
      return language;
    }
  } catch (err) {
    log.warn('Language detection failed, using script fallback', { error: err });
  }

  return detectByScript(text);
}

/**
 * Detect language by Unicode script ranges.
 * 
 * WHY: This handles cases where franc fails — especially short messages
 * or messages written in native scripts (Tamil: U+0B80-U+0BFF, 
 * Devanagari/Hindi: U+0900-U+097F).
 */
function detectByScript(text: string): SupportedLanguage {
  // Check for Tamil Unicode block
  // WHY: Tamil script is in a unique Unicode range, making detection reliable
  const tamilPattern = /[\u0B80-\u0BFF]/;
  if (tamilPattern.test(text)) return 'tamil';

  // Check for Devanagari Unicode block (used by Hindi)
  const devanagariPattern = /[\u0900-\u097F]/;
  if (devanagariPattern.test(text)) return 'hindi';

  // Default to English
  // WHY: English is the most common fallback in Indian contexts, and
  // many Tamil/Hindi speakers also type in Roman script (transliteration)
  return 'english';
}

/**
 * Get a localized system message.
 * 
 * WHY: Rather than calling an API for every small UI string, we
 * maintain a dictionary of common system messages. This is faster
 * and works offline. Only dynamic/user content needs API translation.
 */
export function t(key: string, language: SupportedLanguage): string {
  return TRANSLATIONS[key]?.[language] ?? TRANSLATIONS[key]?.['english'] ?? key;
}

// ─── Translation Dictionary ────────────────────────────────────
// WHY: Pre-translated strings for common bot messages. This avoids
// API calls for repetitive content and ensures consistent messaging.
const TRANSLATIONS: Record<string, Record<SupportedLanguage, string>> = {
  'greeting': {
    english: '👋 Hello! I\'m SahAI, your health companion. How can I help you today?',
    tamil: '👋 வணக்கம்! நான் SahAI, உங்கள் சுகாதார உதவியாளர். இன்று எப்படி உதவ முடியும்?',
    hindi: '👋 नमस्ते! मैं SahAI हूँ, आपका स्वास्थ्य सहायक। आज मैं कैसे मदद कर सकता हूँ?',
  },
  'menu': {
    english: 'Choose a service:\n1️⃣ Health Check\n2️⃣ Government Schemes\n3️⃣ Education\n4️⃣ Emergency\n\nType a number or describe what you need.',
    tamil: 'ஒரு சேவையைத் தேர்ந்தெடுக்கவும்:\n1️⃣ உடல்நிலை பரிசோதனை\n2️⃣ அரசு திட்டங்கள்\n3️⃣ கல்வி\n4️⃣ அவசரநிலை\n\nஎண்ணை டைப் செய்யவும் அல்லது உங்கள் தேவையை விவரிக்கவும்.',
    hindi: 'सेवा चुनें:\n1️⃣ स्वास्थ्य जांच\n2️⃣ सरकारी योजनाएं\n3️⃣ शिक्षा\n4️⃣ आपातकालीन\n\nनंबर टाइप करें या बताएं कि आपको क्या चाहिए।',
  },
  'emergency_detected': {
    english: '🚨 I detect an emergency situation. Connecting you to emergency services immediately...',
    tamil: '🚨 அவசர நிலை கண்டறியப்பட்டது. உடனடியாக அவசர சேவைகளுடன் இணைக்கிறேன்...',
    hindi: '🚨 आपातकालीन स्थिति पहचानी गई। तुरंत आपातकालीन सेवाओं से जोड़ रहा हूँ...',
  },
  'processing': {
    english: '⏳ Let me look into that for you...',
    tamil: '⏳ உங்களுக்காக பார்க்கிறேன்...',
    hindi: '⏳ मैं इसे देख रहा हूँ...',
  },
  'error_generic': {
    english: 'Sorry, something went wrong. Please try again or type "menu" for options.',
    tamil: 'மன்னிக்கவும், ஏதோ தவறு ஏற்பட்டது. மீண்டும் முயற்சிக்கவும் அல்லது "menu" என்று டைப் செய்யவும்.',
    hindi: 'क्षमा करें, कुछ गलत हो गया। कृपया पुनः प्रयास करें या "menu" टाइप करें।',
  },
};
