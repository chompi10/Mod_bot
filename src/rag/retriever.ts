/**
 * @file rag/retriever.ts — RAG Retriever (Semantic Search)
 * 
 * WHY RAG (Retrieval-Augmented Generation):
 * The LLM has a finite context window and no persistent memory.
 * RAG solves this by:
 * 1. Storing past conversations as vectors (done by the indexer)
 * 2. When a new question arrives, finding semantically similar past messages
 * 3. Injecting those relevant messages into the LLM's context
 * 
 * EXAMPLE:
 * User: "What medicine did the doctor give me last week?"
 * → RAG finds: "Dr. Priya prescribed Amoxicillin 500mg for 7 days"
 * → LLM can now answer: "Last week, Dr. Priya prescribed Amoxicillin 500mg"
 * 
 * WITHOUT RAG: "I don't have information about your past prescriptions"
 * 
 * RAG DECISION LOGIC:
 * Not every query needs RAG. We skip it when:
 * - The query is a simple greeting ("Hi", "Hello")
 * - The query is about the current conversation (already in short-term memory)
 * - The query is a general knowledge question (not user-specific)
 * We USE it when:
 * - The query references past events ("last time", "before", "what did I")
 * - The query asks about health history, medications, appointments
 * - The query is specific to the user's context
 */

import { embed } from './embeddings.js';
import { VectorStore } from './vector-store.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('RAGRetriever');

/**
 * Keywords that suggest the user is referencing past interactions.
 * WHY: Simple heuristic to decide when RAG is needed. This avoids
 * unnecessary embedding API calls for messages that don't need history.
 */
const HISTORY_INDICATORS = [
  'last time', 'before', 'previously', 'remember', 'what did',
  'my medication', 'my doctor', 'my appointment', 'my allergy',
  'you told me', 'we discussed', 'earlier', 'ago',
  // Tamil indicators
  'முன்பு', 'கடந்த', 'நினைவு',
  // Hindi indicators  
  'पहले', 'पिछली', 'याद',
];

/**
 * Determine if RAG search should be performed for this query.
 * 
 * WHY: RAG adds ~200-500ms latency (embedding API call + search).
 * We only want to pay this cost when it's likely to be useful.
 * This function implements the "RAG decision logic" from the spec.
 */
export function shouldUseRAG(query: string): boolean {
  const lower = query.toLowerCase();
  
  // Skip for very short messages (greetings, single words)
  if (query.length < 15) return false;
  
  // Skip for menu selections
  if (/^[1-4]$/.test(query.trim())) return false;

  // Use RAG if any history indicator is present
  if (HISTORY_INDICATORS.some((indicator) => lower.includes(indicator))) {
    return true;
  }

  // Use RAG for questions (heuristic: ends with ?)
  if (query.trim().endsWith('?')) return true;

  // Default: don't use RAG for simple statements
  return false;
}

/**
 * Retrieve relevant past context using semantic search.
 * 
 * FLOW:
 * 1. Embed the user's query into a vector
 * 2. Search the vector store for similar past messages
 * 3. Filter by relevance score (discard weak matches)
 * 4. Format results into a context string for the LLM
 */
export async function retrieve(
  userId: string,
  query: string,
  topK = 5,
  minScore = 0.7  // WHY 0.7: Below this, results are too loosely related
): Promise<string> {
  try {
    // Step 1: Embed the query
    const queryVector = await embed(query);

    // Step 2: Search
    const results = VectorStore.search(userId, queryVector, topK);

    // Step 3: Filter by minimum relevance score
    const relevant = results.filter((r) => r.score >= minScore);

    if (relevant.length === 0) {
      log.debug('No relevant RAG results', { userId, query: query.slice(0, 50) });
      return '';
    }

    // Step 4: Format for LLM context
    // WHY this format: The LLM needs to understand these are PAST messages,
    // not current ones. Clear labeling prevents confusion.
    const contextParts = relevant.map((r) => {
      const role = r.metadata['role'] === 'user' ? 'User' : 'SahAI';
      const time = r.metadata['timestamp'] ?? 'unknown time';
      return `[${role}, ${time}] ${r.text}`;
    });

    const context = `--- Relevant past conversations ---\n${contextParts.join('\n')}\n--- End past conversations ---`;

    log.debug('RAG context assembled', {
      userId,
      resultsCount: relevant.length,
      topScore: relevant[0]?.score,
    });

    return context;
  } catch (error) {
    log.error('RAG retrieval failed', { error, userId });
    // WHY: RAG failure is non-fatal. The bot can still respond using
    // other memory layers (MEMORY.md, short-term, etc.)
    return '';
  }
}
