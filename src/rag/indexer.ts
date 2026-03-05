/**
 * @file rag/indexer.ts — Background Message Indexer
 * 
 * WHY BACKGROUND INDEXING:
 * Embedding messages is an async API call (~100-300ms per batch).
 * We can't do this synchronously during message handling — it would
 * make the bot feel slow. Instead, we index in the background:
 * 
 * 1. New messages are queued as they arrive
 * 2. Every RAG_INDEX_INTERVAL_MS, the indexer processes the queue
 * 3. Messages are embedded and added to the vector store
 * 
 * PATTERN: "Background Worker" — decouples indexing from the request path.
 * 
 * ANALOGY: Like a librarian who catalogs new books after the library
 * closes, rather than making visitors wait while each book is filed.
 */

import { MessageRepo } from '../db/client.js';
import { embedBatch } from './embeddings.js';
import { VectorStore } from './vector-store.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('RAGIndexer');

/**
 * Queue of messages waiting to be indexed.
 * WHY: Decouples message arrival from indexing. Messages can arrive
 * faster than we can embed them.
 */
const indexQueue: Array<{
  id: string;
  userId: string;
  text: string;
  metadata: Record<string, string>;
}> = [];

/**
 * Track which message IDs have been indexed to avoid duplicates.
 * WHY: Without this, the same message could be indexed multiple times
 * if the indexer runs while new messages are being queued.
 */
const indexedIds = new Set<string>();

export const RAGIndexer = {
  _intervalId: null as NodeJS.Timeout | null,

  /**
   * Start the background indexer.
   */
  start(): void {
    log.info('Starting RAG indexer', { intervalMs: config.RAG_INDEX_INTERVAL_MS });

    this._intervalId = setInterval(async () => {
      try { await this.processQueue(); }
      catch (err) { log.error('Indexer tick failed', { error: err }); }
    }, config.RAG_INDEX_INTERVAL_MS);
  },

  stop(): void {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  },

  /**
   * Queue a message for indexing.
   * Called by the message handler after each user/bot message.
   */
  queueMessage(id: string, userId: string, text: string, role: string): void {
    if (indexedIds.has(id)) return;
    if (text.length < 5) return;  // Skip very short messages (e.g., "ok", "hi")

    indexQueue.push({
      id,
      userId,
      text,
      metadata: {
        role,
        userId,
        timestamp: new Date().toISOString(),
      },
    });
  },

  /**
   * Process the indexing queue.
   * 
   * WHY batch processing: Embedding API calls have overhead. Batching
   * 50 messages into one API call is much faster than 50 individual calls.
   */
  async processQueue(): Promise<void> {
    if (indexQueue.length === 0) return;

    // WHY: Process in chunks to avoid overwhelming the API
    const BATCH_SIZE = 50;
    const batch = indexQueue.splice(0, BATCH_SIZE);

    log.debug('Processing index batch', { size: batch.length, remaining: indexQueue.length });

    try {
      const texts = batch.map((item) => item.text);
      const vectors = await embedBatch(texts);

      // Add to vector store
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i]!;
        VectorStore.upsert(item.userId, {
          id: item.id,
          text: item.text,
          vector: vectors[i]!,
          metadata: item.metadata,
        });
        indexedIds.add(item.id);
      }

      log.info('Indexed messages', { count: batch.length });
    } catch (error) {
      log.error('Batch indexing failed, re-queuing', { error, batchSize: batch.length });
      // Re-queue failed items for retry
      indexQueue.unshift(...batch);
    }
  },

  /**
   * Index historical messages for a user (called on first interaction).
   * 
   * WHY: When a returning user sends a message, we want RAG search
   * to work immediately. This loads their past 200 messages from the
   * database and indexes them.
   */
  async indexHistorical(userId: string): Promise<void> {
    const existing = VectorStore.count(userId);
    if (existing > 0) {
      log.debug('User already has vectors, skipping historical index', { userId, existing });
      return;
    }

    const messages = MessageRepo.getRecentByUser(userId, 200);
    if (messages.length === 0) return;

    log.info('Indexing historical messages', { userId, count: messages.length });

    for (const msg of messages) {
      this.queueMessage(msg.id, userId, msg.content, msg.role);
    }

    // Process immediately rather than waiting for next tick
    await this.processQueue();
  },

  /**
   * Get queue stats for monitoring.
   */
  stats(): { queueSize: number; indexedCount: number } {
    return { queueSize: indexQueue.length, indexedCount: indexedIds.size };
  },
};
