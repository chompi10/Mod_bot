/**
 * @file memory/short-term.ts — Short-Term Memory (Conversation Buffer)
 * 
 * WHY: The LLM needs recent conversation context to maintain coherent
 * multi-turn dialogues. Without this, every message would be treated
 * as a brand new conversation — the bot would forget what the user
 * said 2 messages ago.
 * 
 * PATTERN: LRU-style buffer — we keep the last N messages per session.
 * This is the fastest memory layer (pure in-memory, no I/O).
 * 
 * LIFECYCLE: Created when a session starts, garbage-collected when
 * the session expires or the server restarts. Nothing is persisted
 * here — that's what the database and file-backed memory are for.
 */

import type { Message } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ShortTermMemory');

/**
 * Maximum messages to keep in the buffer per session.
 * 
 * WHY 20: With an average of ~100 tokens per message, 20 messages ≈ 2000 tokens.
 * This leaves plenty of room in the context window for system prompt,
 * memory, RAG results, and the LLM's response. Adjust based on your
 * model's context limit (GPT-4o supports 128K tokens).
 */
const MAX_BUFFER_SIZE = 20;

/**
 * In-memory store: sessionId → message buffer
 * 
 * WHY Map over Object: Maps have O(1) delete and don't suffer from
 * prototype pollution. They're the right choice for dynamic key stores.
 */
const buffers = new Map<string, Message[]>();

export const ShortTermMemory = {
  /**
   * Add a message to the session buffer.
   * If the buffer exceeds MAX_BUFFER_SIZE, the oldest message is evicted.
   * 
   * WHY evict oldest: Recent context is more valuable than old context.
   * The user's last few messages contain the current intent, while
   * messages from 30 turns ago are likely about a different topic.
   */
  add(sessionId: string, message: Message): void {
    if (!buffers.has(sessionId)) {
      buffers.set(sessionId, []);
    }

    const buffer = buffers.get(sessionId)!;
    buffer.push(message);

    // Evict oldest if over capacity
    if (buffer.length > MAX_BUFFER_SIZE) {
      const evicted = buffer.shift();
      log.debug('Evicted oldest message from buffer', {
        sessionId,
        evictedRole: evicted?.role,
        bufferSize: buffer.length,
      });
    }
  },

  /**
   * Get all messages in the current session buffer.
   * Returns a copy to prevent external mutation.
   */
  get(sessionId: string): Message[] {
    return [...(buffers.get(sessionId) ?? [])];
  },

  /**
   * Get the last N messages (useful for quick context checks).
   */
  getRecent(sessionId: string, count: number): Message[] {
    const buffer = buffers.get(sessionId) ?? [];
    return buffer.slice(-count);
  },

  /**
   * Clear the buffer for a session.
   * Called when a session expires or the user explicitly says "start over".
   */
  clear(sessionId: string): void {
    buffers.delete(sessionId);
    log.debug('Cleared short-term memory', { sessionId });
  },

  /**
   * Get buffer stats (for monitoring/debugging).
   */
  stats(): { activeSessions: number; totalMessages: number } {
    let totalMessages = 0;
    buffers.forEach((buf) => { totalMessages += buf.length; });
    return { activeSessions: buffers.size, totalMessages };
  },

  /**
   * Garbage-collect stale sessions.
   * 
   * WHY: Without GC, the Map grows unbounded as new sessions are created.
   * We check the last message timestamp and evict sessions older than
   * the timeout. Called periodically by the heartbeat system.
   */
  gc(maxAgeMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let evicted = 0;

    buffers.forEach((buffer, sessionId) => {
      const lastMessage = buffer[buffer.length - 1];
      if (!lastMessage || now - lastMessage.timestamp.getTime() > maxAgeMs) {
        buffers.delete(sessionId);
        evicted++;
      }
    });

    if (evicted > 0) {
      log.info('Garbage-collected stale sessions', { evicted, remaining: buffers.size });
    }
    return evicted;
  },
};
