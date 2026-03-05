/**
 * @file memory/long-term.ts — Long-Term File-Backed Memory
 * 
 * WHY FILE-BACKED (not just database):
 * 1. Human-readable: You can open MEMORY.md in any text editor to inspect
 *    what the bot "knows" about a user. Essential for debugging & trust.
 * 2. LLM-native: Markdown is the format LLMs understand best. Injecting
 *    MEMORY.md directly into the context window requires zero transformation.
 * 3. Version-controllable: Memory files can be git-tracked, diffed, and
 *    rolled back. Try doing that with a database blob.
 * 4. Portable: Users can request their memory export — just zip the folder.
 * 
 * MEMORY HIERARCHY:
 * - MEMORY.md: Curated, distilled knowledge (like a patient chart summary)
 * - memory/YYYY-MM-DD.md: Daily raw logs (like daily clinical notes)
 * 
 * The daily logs capture everything; MEMORY.md captures only what matters.
 * Periodically, daily logs are "distilled" — important items are promoted
 * to MEMORY.md, and old daily logs can be archived.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import dayjs from 'dayjs';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('LongTermMemory');

// ─── Memory Directory Structure ─────────────────────────────────
// WHY per-user directories: Privacy isolation. User A's memories
// are physically separated from User B's, making it impossible to
// accidentally leak data across users.

function getUserMemoryDir(userId: string): string {
  // WHY: We sanitize the userId (phone number) to create a safe directory name
  const safeId = userId.replace(/[^a-zA-Z0-9+]/g, '_');
  const dir = join(config.MEMORY_DIR, safeId);
  mkdirSync(join(dir, 'memory'), { recursive: true });
  return dir;
}

export const LongTermMemory = {
  // ─── MEMORY.md Operations ───────────────────────────────────

  /**
   * Read the user's MEMORY.md file.
   * 
   * WHEN TO CALL: Before EVERY response that might reference past
   * interactions, health history, preferences, or commitments.
   * This is the MANDATORY recall step specified in the memory rules.
   * 
   * WHY: The LLM has no persistent memory between API calls. Without
   * reading MEMORY.md, it would "forget" that the user is diabetic,
   * prefers Tamil, or has an appointment on Thursday.
   */
  readMemory(userId: string): string {
    const memoryPath = join(getUserMemoryDir(userId), 'MEMORY.md');
    
    if (!existsSync(memoryPath)) {
      // WHY: Return a template instead of empty string so the LLM knows
      // the memory system exists but is empty — it can then offer to learn.
      return '# Memory\n\n_No memories stored yet. I will remember important information from our conversations._\n';
    }

    return readFileSync(memoryPath, 'utf-8');
  },

  /**
   * Append a new entry to MEMORY.md.
   * 
   * WHAT GOES HERE (from the spec):
   * - Decisions and commitments ("User chose morning slot")
   * - Recurring preferences ("User prefers Tamil language")
   * - Medical facts ("Allergic to penicillin, Type 2 diabetes since 2019")
   * - Key relationships ("Emergency contact: Amma at +91XXXXXXXXXX")
   * 
   * WHAT DOES NOT GO HERE:
   * - Transient events ("User asked about weather")
   * - Raw conversation logs (those go in daily notes)
   * - Temporary session state (that's working memory)
   */
  writeMemory(userId: string, entry: string, category: string): void {
    const memoryPath = join(getUserMemoryDir(userId), 'MEMORY.md');
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm');

    let content: string;
    if (!existsSync(memoryPath)) {
      content = `# Memory\n\n## ${category}\n- [${timestamp}] ${entry}\n`;
    } else {
      const existing = readFileSync(memoryPath, 'utf-8');
      
      // WHY: We organize by category headers for easy scanning
      const categoryHeader = `## ${category}`;
      if (existing.includes(categoryHeader)) {
        // Append under existing category
        content = existing.replace(
          categoryHeader,
          `${categoryHeader}\n- [${timestamp}] ${entry}`
        );
      } else {
        // Add new category section
        content = existing + `\n${categoryHeader}\n- [${timestamp}] ${entry}\n`;
      }
    }

    writeFileSync(memoryPath, content, 'utf-8');
    log.info('Memory updated', { userId, category, entryPreview: entry.slice(0, 50) });
  },

  // ─── Daily Log Operations ───────────────────────────────────

  /**
   * Append to today's daily log.
   * 
   * WHAT GOES HERE (from the spec):
   * - Raw events ("User asked about headache at 10:30 AM")
   * - Scratch notes ("Discussed 3 symptoms: fever, cough, fatigue")
   * - Running logs ("Appointment booked: Dr. Priya, Jan 15 at 10 AM")
   * 
   * WHY DAILY FILES: Organizing by date makes it easy to:
   * 1. Find "what happened yesterday" for context
   * 2. Implement retention policies (delete logs > 30 days)
   * 3. Run daily distillation (promote important items to MEMORY.md)
   */
  appendDailyLog(userId: string, entry: string): void {
    const today = dayjs().format('YYYY-MM-DD');
    const logPath = join(getUserMemoryDir(userId), 'memory', `${today}.md`);
    const timestamp = dayjs().format('HH:mm');

    let content: string;
    if (!existsSync(logPath)) {
      content = `# Daily Log — ${today}\n\n- [${timestamp}] ${entry}\n`;
    } else {
      content = readFileSync(logPath, 'utf-8') + `- [${timestamp}] ${entry}\n`;
    }

    writeFileSync(logPath, content, 'utf-8');
  },

  /**
   * Read today's daily log.
   */
  readDailyLog(userId: string, date?: string): string {
    const target = date ?? dayjs().format('YYYY-MM-DD');
    const logPath = join(getUserMemoryDir(userId), 'memory', `${target}.md`);
    
    if (!existsSync(logPath)) return '';
    return readFileSync(logPath, 'utf-8');
  },

  /**
   * Read recent daily logs (last N days).
   * 
   * WHY: When answering questions about recent interactions, we may
   * need to look back several days. This retrieves a combined view.
   */
  readRecentLogs(userId: string, days: number = 7): string {
    const logs: string[] = [];
    
    for (let i = 0; i < days; i++) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const content = this.readDailyLog(userId, date);
      if (content) logs.push(content);
    }

    return logs.join('\n---\n');
  },

  /**
   * Distill daily logs into MEMORY.md.
   * 
   * WHY: Daily logs accumulate raw events. Over time, this becomes too
   * much to inject into the context window. Distillation extracts the
   * key facts and promotes them to MEMORY.md, keeping it concise.
   * 
   * HACKATHON NOTE: In production, this would use the LLM to summarize
   * and extract key facts. For now, we do a simple importance-based filter.
   */
  async distill(userId: string, importantEntries: string[]): Promise<void> {
    for (const entry of importantEntries) {
      this.writeMemory(userId, entry, 'Distilled Notes');
    }
    log.info('Distillation complete', { userId, entriesPromoted: importantEntries.length });
  },

  /**
   * Search across all memory files for a keyword.
   * 
   * WHY: When the LLM needs to recall something specific ("What was
   * my blood pressure last time?"), keyword search across all memory
   * files finds it faster than reading everything sequentially.
   */
  search(userId: string, query: string): string[] {
    const results: string[] = [];
    const dir = getUserMemoryDir(userId);
    const keywords = query.toLowerCase().split(/\s+/);

    // Search MEMORY.md
    const memory = this.readMemory(userId);
    const memoryLines = memory.split('\n').filter((line) =>
      keywords.some((kw) => line.toLowerCase().includes(kw))
    );
    results.push(...memoryLines);

    // Search recent daily logs
    const recentLogs = this.readRecentLogs(userId, 14);
    const logLines = recentLogs.split('\n').filter((line) =>
      keywords.some((kw) => line.toLowerCase().includes(kw))
    );
    results.push(...logLines);

    return results;
  },
};
