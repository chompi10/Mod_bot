/**
 * @file rag/vector-store.ts — In-Memory Vector Store
 * 
 * WHY IN-MEMORY (not Pinecone/Weaviate):
 * 1. Zero setup — no external services needed for the hackathon
 * 2. Fast — no network latency for vector searches
 * 3. Good enough — with 200 messages per user, brute-force cosine
 *    similarity is fast enough (<10ms)
 * 
 * TRADEOFF: This doesn't persist across restarts and doesn't scale
 * beyond ~10K vectors per user. For production:
 * - Use Pinecone for managed vector DB
 * - Use pgvector for Postgres-backed vectors
 * - Use hnswlib-node for fast local approximate nearest neighbor
 * 
 * PATTERN: Simple vector store with CRUD + similarity search.
 * The interface is designed to be easily swappable with a production
 * vector DB — all methods return the same types.
 */

import { cosineSimilarity } from './embeddings.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('VectorStore');

interface VectorEntry {
  /** Unique ID (usually the message ID) */
  id: string;
  /** The original text that was embedded */
  text: string;
  /** The embedding vector */
  vector: number[];
  /** Metadata for filtering (userId, timestamp, category, etc.) */
  metadata: Record<string, string>;
}

interface SearchResult {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, string>;
}

/**
 * Per-user vector stores.
 * WHY per-user: Privacy isolation + faster search (smaller index per user).
 */
const stores = new Map<string, VectorEntry[]>();

export const VectorStore = {
  /**
   * Add a vector entry to a user's store.
   */
  upsert(userId: string, entry: VectorEntry): void {
    if (!stores.has(userId)) {
      stores.set(userId, []);
    }

    const store = stores.get(userId)!;

    // WHY upsert: If the same message is re-indexed (e.g., after a
    // correction), we want to update rather than duplicate
    const existingIdx = store.findIndex((e) => e.id === entry.id);
    if (existingIdx >= 0) {
      store[existingIdx] = entry;
    } else {
      store.push(entry);

      // WHY cap at 500: Prevents unbounded memory growth.
      // Older entries are evicted first (FIFO).
      if (store.length > 500) {
        store.shift();
      }
    }
  },

  /**
   * Semantic search: find the most similar texts to a query vector.
   * 
   * WHY this is the core of RAG:
   * When a user asks "What medication did the doctor prescribe?", we:
   * 1. Embed this question → queryVector
   * 2. Search the vector store for similar past messages
   * 3. Return the top-K results (e.g., "Dr. Priya prescribed Metformin 500mg")
   * 4. Include these results in the LLM context
   * 
   * This way, the LLM can answer questions about past conversations
   * without having ALL messages in its context window.
   */
  search(userId: string, queryVector: number[], topK = 5, filter?: Record<string, string>): SearchResult[] {
    const store = stores.get(userId);
    if (!store || store.length === 0) return [];

    // WHY brute force: With < 500 vectors, brute force is fast enough.
    // For production with millions of vectors, use HNSW (approximate NN).
    const scored = store
      .filter((entry) => {
        // Apply metadata filters if provided
        if (!filter) return true;
        return Object.entries(filter).every(
          ([key, value]) => entry.metadata[key] === value
        );
      })
      .map((entry) => ({
        id: entry.id,
        text: entry.text,
        score: cosineSimilarity(queryVector, entry.vector),
        metadata: entry.metadata,
      }))
      // WHY sort descending: Higher similarity = better match
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    log.debug('Vector search completed', {
      userId,
      resultsCount: scored.length,
      topScore: scored[0]?.score ?? 0,
    });

    return scored;
  },

  /**
   * Get the number of vectors stored for a user.
   */
  count(userId: string): number {
    return stores.get(userId)?.length ?? 0;
  },

  /**
   * Clear a user's vector store.
   */
  clear(userId: string): void {
    stores.delete(userId);
  },

  /**
   * Get store stats for monitoring.
   */
  stats(): { users: number; totalVectors: number } {
    let totalVectors = 0;
    stores.forEach((store) => { totalVectors += store.length; });
    return { users: stores.size, totalVectors };
  },
};
