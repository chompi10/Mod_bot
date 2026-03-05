/**
 * @file memory/working.ts — Working Memory (Session Scratch Notes)
 * 
 * WHY: Working memory sits between short-term (raw messages) and
 * long-term (MEMORY.md) storage. It holds "session notes" — structured
 * observations extracted during a conversation that haven't yet been
 * deemed important enough for long-term storage.
 * 
 * ANALOGY: Think of it like a doctor's scratch pad during a consultation.
 * They jot down symptoms as the patient describes them, then later
 * transcribe the important findings into the patient's chart (MEMORY.md).
 * 
 * EXAMPLES of working memory entries:
 * - "User mentioned headache started 3 days ago"
 * - "User is asking about Ayushman Bharat scheme"
 * - "User prefers morning appointments"
 * 
 * LIFECYCLE: Created during conversation, reviewed at session end.
 * Important entries are promoted to MEMORY.md; the rest are discarded.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('WorkingMemory');

export interface WorkingNote {
  /** What was observed/noted */
  content: string;
  /** Category helps prioritize what to keep */
  category: 'symptom' | 'preference' | 'fact' | 'intent' | 'action';
  /** Importance score (0-1): higher = more likely to be promoted to MEMORY.md */
  importance: number;
  /** When this note was created */
  timestamp: Date;
}

/**
 * In-memory session notes store.
 * WHY: Separate from short-term memory because these are EXTRACTED
 * observations, not raw messages. The LLM generates these during
 * conversation processing.
 */
const sessionNotes = new Map<string, WorkingNote[]>();

export const WorkingMemory = {
  /**
   * Add a note to the session's working memory.
   * 
   * Called by agents after processing each user message. For example,
   * the health agent might add: { content: "Patient reports fever for 2 days",
   * category: "symptom", importance: 0.8 }
   */
  addNote(sessionId: string, note: Omit<WorkingNote, 'timestamp'>): void {
    if (!sessionNotes.has(sessionId)) {
      sessionNotes.set(sessionId, []);
    }

    sessionNotes.get(sessionId)!.push({
      ...note,
      timestamp: new Date(),
    });

    log.debug('Working memory note added', {
      sessionId,
      category: note.category,
      importance: note.importance,
    });
  },

  /**
   * Get all notes for a session, optionally filtered by category.
   */
  getNotes(sessionId: string, category?: WorkingNote['category']): WorkingNote[] {
    const notes = sessionNotes.get(sessionId) ?? [];
    return category ? notes.filter((n) => n.category === category) : notes;
  },

  /**
   * Get high-importance notes that should be promoted to MEMORY.md.
   * 
   * WHY: Not everything in working memory is worth persisting. Only
   * notes above the importance threshold are candidates for long-term
   * storage. This prevents MEMORY.md from becoming a noisy dump.
   * 
   * THRESHOLD 0.6: Empirically chosen — captures medical facts, strong
   * preferences, and committed actions, but filters out casual mentions.
   */
  getPromotionCandidates(sessionId: string): WorkingNote[] {
    const PROMOTION_THRESHOLD = 0.6;
    return this.getNotes(sessionId).filter((n) => n.importance >= PROMOTION_THRESHOLD);
  },

  /**
   * Generate a summary of the session's working memory.
   * 
   * WHY: When assembling context for the LLM, we don't send raw notes.
   * Instead, we generate a concise summary that captures the key points.
   * This is more token-efficient and produces better LLM responses.
   */
  getSummary(sessionId: string): string {
    const notes = this.getNotes(sessionId);
    if (notes.length === 0) return '';

    // Group by category for organized presentation
    const grouped: Record<string, string[]> = {};
    for (const note of notes) {
      if (!grouped[note.category]) grouped[note.category] = [];
      grouped[note.category]!.push(note.content);
    }

    const parts: string[] = [];
    for (const [category, items] of Object.entries(grouped)) {
      parts.push(`[${category}]: ${items.join('; ')}`);
    }

    return `Session notes: ${parts.join(' | ')}`;
  },

  /**
   * Clear notes for a session after they've been processed.
   */
  clear(sessionId: string): void {
    sessionNotes.delete(sessionId);
  },

  /**
   * Garbage collect stale sessions (called by heartbeat).
   */
  gc(maxAgeMs: number = 60 * 60 * 1000): void {
    const now = Date.now();
    sessionNotes.forEach((notes, sessionId) => {
      const lastNote = notes[notes.length - 1];
      if (!lastNote || now - lastNote.timestamp.getTime() > maxAgeMs) {
        sessionNotes.delete(sessionId);
      }
    });
  },
};
