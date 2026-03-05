/**
 * @file config/index.ts — Centralized Configuration
 * 
 * WHY: A single source of truth for all configuration prevents scattered
 * process.env calls throughout the codebase. Zod validation ensures we
 * fail fast at startup if required values are missing, rather than
 * crashing mid-conversation when a user sends their first message.
 * 
 * PATTERN: "Fail Fast" — Validate everything at boot time.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file before anything else
dotenv.config();

// ─── Schema Definition ─────────────────────────────────────────
// WHY: Zod gives us runtime type checking AND TypeScript inference.
// This means config.OPENAI_API_KEY is typed as `string` automatically.
const ConfigSchema = z.object({
  // OpenAI
  OPENAI_API_KEY: z.string().min(1, 'OpenAI API key is required'),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  // Twilio WhatsApp
  TWILIO_ACCOUNT_SID: z.string().default('AC_placeholder'),
  TWILIO_AUTH_TOKEN: z.string().default('placeholder'),
  TWILIO_WHATSAPP_NUMBER: z.string().default('whatsapp:+14155238886'),

  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  WEBHOOK_BASE_URL: z.string().default('http://localhost:3000'),

  // Database
  DATABASE_PATH: z.string().default('./data/sahai.db'),

  // Memory
  MEMORY_DIR: z.string().default('./memory'),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().default(300_000),  // 5 min
  RAG_INDEX_INTERVAL_MS: z.coerce.number().default(60_000),   // 1 min

  // Emergency numbers (India defaults)
  AMBULANCE_NUMBER: z.string().default('108'),
  POLICE_NUMBER: z.string().default('100'),
  FIRE_NUMBER: z.string().default('101'),
  WOMEN_HELPLINE: z.string().default('181'),
  CHILD_HELPLINE: z.string().default('1098'),

  // GitHub (optional)
  GITHUB_PERSONAL_TOKEN: z.string().optional(),
});

// ─── Parse & Export ─────────────────────────────────────────────
// WHY: We parse once at import time. If this fails, the process exits
// immediately with a clear error message showing which fields are wrong.
let config: z.infer<typeof ConfigSchema>;

try {
  config = ConfigSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Configuration validation failed:');
    error.errors.forEach((e) => {
      console.error(`   ${e.path.join('.')}: ${e.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export { config };
export type Config = z.infer<typeof ConfigSchema>;
