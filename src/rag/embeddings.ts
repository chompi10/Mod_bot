/**
 * @file rag/embeddings.ts — OpenAI Embedding Integration
 * 
 * WHY: Embeddings convert text into numerical vectors that capture
 * semantic meaning. "I have a headache" and "my head hurts" produce
 * similar vectors even though the words are different. This enables
 * semantic search — finding relevant past conversations by meaning,
 * not just keyword matching.
 * 
 * MODEL CHOICE: text-embedding-3-small
 * - 1536 dimensions (good balance of quality vs speed)
 * - $0.02 per 1M tokens (extremely cheap)
 * - Supports 8191 tokens per request
 * 
 * TRADEOFF: text-embedding-3-large is more accurate but 6x more
 * expensive and slower. For a WhatsApp bot where responses need
 * to be fast, the small model is the right choice.
 */

import OpenAI from 'openai';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Embeddings');

// WHY: Singleton client — we reuse one connection for all requests
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

/**
 * Generate an embedding vector for a single text.
 * 
 * WHY single text: Most of our use cases process one message at a time
 * (user sends a message → embed it → search). The batch variant below
 * handles bulk operations (initial indexing).
 */
export async function embed(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: config.OPENAI_EMBEDDING_MODEL,
      input: text,
    });

    return response.data[0]!.embedding;
  } catch (error) {
    log.error('Embedding failed', { error, textLength: text.length });
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in a single API call.
 * 
 * WHY batch: When indexing 200 past messages, making 200 separate
 * API calls would be slow and wasteful. The OpenAI API supports
 * batching up to 2048 texts per request, reducing latency and cost.
 * 
 * CAVEAT: Total tokens across all texts must stay under 8191 * batch_size.
 * We chunk if the batch is too large.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // WHY chunk at 100: Stay well under API limits while still batching
  const CHUNK_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);
    
    try {
      const response = await openai.embeddings.create({
        model: config.OPENAI_EMBEDDING_MODEL,
        input: chunk,
      });

      // WHY sort by index: The API may return results out of order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      results.push(...sorted.map((d) => d.embedding));
    } catch (error) {
      log.error('Batch embedding failed', { error, chunkSize: chunk.length });
      // WHY: On failure, generate zero vectors as placeholders.
      // The indexer can retry these later.
      results.push(...chunk.map(() => new Array(1536).fill(0)));
    }
  }

  return results;
}

/**
 * Calculate cosine similarity between two vectors.
 * 
 * WHY cosine similarity (not euclidean distance):
 * Cosine similarity measures the angle between vectors, which captures
 * semantic similarity regardless of text length. A long paragraph and
 * a short sentence about the same topic will have high cosine similarity
 * even though their vector magnitudes differ.
 * 
 * Returns: 0 (completely different) to 1 (identical meaning)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
