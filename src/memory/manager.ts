/**
 * @file memory/manager.ts — Unified Memory Manager
 * 
 * WHY: The memory system has 5 layers (short-term, working, long-term,
 * profile, heartbeat). Individual agents shouldn't need to know about
 * all of them. The MemoryManager provides a single interface that:
 * 
 * 1. Assembles memory context for LLM requests (the critical path)
 * 2. Handles writing to the appropriate layer
 * 3. Manages the distillation pipeline (daily logs → MEMORY.md)
 * 
 * PATTERN: "Façade" — simplifies a complex subsystem behind one API.
 * 
 * This is the most important file in the memory system. Every agent
 * interaction flows through assembleContext() before making an LLM call.
 */

import { ShortTermMemory } from './short-term.js';
import { WorkingMemory, type WorkingNote } from './working.js';
import { LongTermMemory } from './long-term.js';
import { ProfileManager } from './profile.js';
import { HeartbeatManager } from './heartbeat.js';
import { createLogger } from '../utils/logger.js';
import type { Message } from '../db/schema.js';

const log = createLogger('MemoryManager');

/**
 * The assembled context that gets injected into every LLM call.
 * 
 * WHY this structure: Each field maps to a section of the LLM's
 * system/user prompt. The agent formats these into a coherent
 * prompt before calling OpenAI.
 */
export interface AssembledContext {
  /** From SOUL.md — bot personality and guardrails */
  soul: string;
  /** From USER.md — user preferences, medical profile */
  userProfile: string;
  /** From MEMORY.md — curated long-term knowledge */
  memory: string;
  /** From working memory — current session notes */
  sessionNotes: string;
  /** From short-term memory — recent message history */
  recentMessages: Message[];
  /** From RAG — relevant past conversations (added by RAG system) */
  ragContext?: string;
  /** From TOOLS.md — available integrations */
  tools: string;
  /** Active reminders for this user */
  activeReminders: string;
}

export const MemoryManager = {
  /**
   * CRITICAL METHOD: Assemble full context for an LLM request.
   * 
   * This is called BEFORE every LLM call. The order of assembly matches
   * the context assembly spec:
   * 1. Memory context (MEMORY.md + relevant daily logs)
   * 2. Conversation history (last 10-20 messages)
   * 3. RAG context (added separately by the RAG system)
   * 4. Available tools (from TOOLS.md)
   * 5. User profile (from USER.md)
   * 6. Current prompt (added by the agent)
   * 
   * WHY this order: The system prompt (soul) goes first because it
   * defines behavior. User profile goes before memory because it's
   * more stable. Recent messages go last because they're most relevant.
   */
  assembleContext(userId: string, sessionId: string): AssembledContext {
    log.debug('Assembling context', { userId, sessionId });

    // 1. Bot personality (read once, rarely changes)
    const soul = ProfileManager.readSoul();

    // 2. User profile (updated occasionally)
    const userProfile = ProfileManager.readUserProfile(userId);

    // 3. Long-term memory (MANDATORY recall step)
    // WHY: This is the step the spec calls "MANDATORY" — before answering
    // about prior work/preferences/health, we MUST check MEMORY.md
    const memory = LongTermMemory.readMemory(userId);

    // 4. Working memory (current session observations)
    const sessionNotes = WorkingMemory.getSummary(sessionId);

    // 5. Recent messages (conversation history)
    const recentMessages = ShortTermMemory.get(sessionId);

    // 6. Tools info
    const tools = ProfileManager.readTools();

    // 7. Active reminders (so the bot can reference them)
    const reminders = HeartbeatManager.getReminders(userId);
    const activeReminders = reminders.length > 0
      ? `Active reminders:\n${reminders.map((r) => `- ${r.type}: ${r.message} (${r.schedule})`).join('\n')}`
      : 'No active reminders.';

    return {
      soul,
      userProfile,
      memory,
      sessionNotes,
      recentMessages,
      tools,
      activeReminders,
    };
  },

  /**
   * Record a user message: adds to short-term memory and daily log.
   */
  recordUserMessage(sessionId: string, userId: string, message: Message): void {
    ShortTermMemory.add(sessionId, message);
    LongTermMemory.appendDailyLog(userId, `[USER] ${message.content}`);
  },

  /**
   * Record a bot response: adds to short-term memory and daily log.
   */
  recordBotResponse(sessionId: string, userId: string, message: Message): void {
    ShortTermMemory.add(sessionId, message);
    LongTermMemory.appendDailyLog(userId, `[BOT] ${message.content.slice(0, 200)}`);
  },

  /**
   * Add a working memory note (extracted by the agent during processing).
   */
  addSessionNote(sessionId: string, note: Omit<WorkingNote, 'timestamp'>): void {
    WorkingMemory.addNote(sessionId, note);
  },

  /**
   * Persist important information to MEMORY.md.
   * Called when the agent identifies something worth remembering long-term.
   */
  rememberLongTerm(userId: string, entry: string, category: string): void {
    LongTermMemory.writeMemory(userId, entry, category);
  },

  /**
   * Update user profile.
   */
  updateProfile(userId: string, section: string, key: string, value: string): void {
    ProfileManager.updateUserProfile(userId, section, key, value);
  },

  /**
   * Search memory for relevant context.
   * Used when the bot needs to recall something specific.
   */
  searchMemory(userId: string, query: string): string[] {
    return LongTermMemory.search(userId, query);
  },

  /**
   * End-of-session cleanup: promote important working memory to MEMORY.md.
   * 
   * WHY: This is the distillation step. When a session ends, we check
   * working memory for high-importance notes and persist them.
   */
  async endSession(sessionId: string, userId: string): Promise<void> {
    const candidates = WorkingMemory.getPromotionCandidates(sessionId);

    if (candidates.length > 0) {
      const entries = candidates.map((c) => c.content);
      await LongTermMemory.distill(userId, entries);
      log.info('Session notes distilled to MEMORY.md', {
        userId,
        promoted: candidates.length,
      });
    }

    // Clean up working memory
    WorkingMemory.clear(sessionId);
  },
};
