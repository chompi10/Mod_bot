/**
 * @file agents/base.agent.ts — Base Agent Class
 * 
 * WHY: All four agents (Health, Scheme, Education, Emergency) share
 * common behavior: context assembly, LLM calling, tool invocation,
 * memory updates. The base agent encapsulates this shared logic so
 * each specialized agent only defines its unique behavior.
 * 
 * PATTERN: "Template Method" — the base class defines the algorithm
 * skeleton (assemble context → call LLM → handle tools → respond),
 * and subclasses override specific steps.
 * 
 * TOOL CALLING LOOP:
 * 1. Assemble full context (memory + history + RAG + tools)
 * 2. Call LLM with context and tool definitions
 * 3. If LLM returns tool_calls: execute them, feed results back to LLM
 * 4. Repeat step 2-3 up to MAX_ITERATIONS
 * 5. Return final text response
 * 
 * This loop handles multi-step tasks like:
 * "Find a cardiologist and book an appointment"
 * → tool_call: hospital_finder → result → tool_call: appointment_booker → result → final response
 */

import OpenAI from 'openai';
import { config } from '../config/index.js';
import { MemoryManager, type AssembledContext } from '../memory/manager.js';
import { ToolRegistry } from '../mcp-tools/registry.js';
import { shouldUseRAG, retrieve } from '../rag/retriever.js';
import { LLMError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import type { Message } from '../db/schema.js';

const log = createLogger('BaseAgent');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

/** Maximum tool-calling iterations to prevent infinite loops */
const MAX_TOOL_ITERATIONS = 5;

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
  sessionNotes: Array<{ content: string; category: string; importance: number }>;
  memoryUpdates: Array<{ entry: string; category: string }>;
}

export abstract class BaseAgent {
  /** Agent name for logging and routing */
  abstract readonly name: string;
  /** System prompt specific to this agent */
  abstract readonly systemPrompt: string;

  /**
   * Process a user message and return a response.
   * This is the main entry point, implementing the full pipeline.
   */
  async process(
    userId: string,
    sessionId: string,
    userMessage: string,
    language: string
  ): Promise<AgentResponse> {
    const startTime = Date.now();
    log.info(`${this.name} processing`, { userId, messagePreview: userMessage.slice(0, 50) });

    // ── Step 1: Assemble Context ──────────────────────────────
    // WHY: Every LLM call needs full context. Without this, the LLM
    // would have no memory of the user or conversation.
    const context = MemoryManager.assembleContext(userId, sessionId);

    // ── Step 2: RAG Retrieval (conditional) ───────────────────
    // WHY: Only fetch RAG context when the query likely references
    // past conversations. This saves ~200ms on simple messages.
    let ragContext = '';
    if (shouldUseRAG(userMessage)) {
      ragContext = await retrieve(userId, userMessage);
      log.debug('RAG context retrieved', { hasContext: ragContext.length > 0 });
    }

    // ── Step 3: Build LLM Messages ───────────────────────────
    const messages = this.buildMessages(context, ragContext, userMessage, language);

    // ── Step 4: Tool Calling Loop ─────────────────────────────
    const toolsUsed: string[] = [];
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      try {
        const completion = await openai.chat.completions.create({
          model: config.OPENAI_MODEL,
          messages,
          tools: ToolRegistry.getOpenAITools() as any,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 1024,
        });

        const choice = completion.choices[0]!;
        const assistantMessage = choice.message;

        // If no tool calls, we have the final response
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          const responseText = assistantMessage.content ?? 'I apologize, I was unable to generate a response.';

          log.info(`${this.name} completed`, {
            iterations,
            toolsUsed,
            duration_ms: Date.now() - startTime,
          });

          return {
            text: responseText,
            toolsUsed,
            sessionNotes: [],
            memoryUpdates: [],
          };
        }

        // Handle tool calls
        // WHY: Push assistant message with tool_calls to maintain conversation flow
        messages.push(assistantMessage as any);

        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs: Record<string, unknown>;

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          log.debug('Executing tool', { tool: toolName, args: Object.keys(toolArgs) });
          toolsUsed.push(toolName);

          const result = await ToolRegistry.execute(toolName, toolArgs);

          // WHY: Feed tool results back into the conversation so the LLM
          // can incorporate them into its response
          messages.push({
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: JSON.stringify(result.result),
          });
        }

        // Continue loop — LLM will process tool results
      } catch (error) {
        log.error('LLM call failed', { error, iteration: iterations });

        if (iterations >= MAX_TOOL_ITERATIONS) {
          throw new LLMError('Maximum tool iterations exceeded');
        }
        // WHY: On transient errors, retry the loop
        continue;
      }
    }

    // Fallback if loop exhausted
    return {
      text: 'I apologize, I had trouble processing your request. Could you please try again?',
      toolsUsed,
      sessionNotes: [],
      memoryUpdates: [],
    };
  }

  /**
   * Build the messages array for the OpenAI API call.
   * 
   * WHY this structure:
   * - System message: Bot personality (SOUL.md) + agent-specific instructions
   * - Context block: Memory + user profile + RAG results
   * - Conversation history: Recent messages for continuity
   * - User message: The current request
   */
  private buildMessages(
    context: AssembledContext,
    ragContext: string,
    userMessage: string,
    language: string
  ): any[] {
    const messages: any[] = [];

    // 1. System prompt with full context
    const systemContent = [
      context.soul,
      '\n--- AGENT INSTRUCTIONS ---\n',
      this.systemPrompt,
      '\n--- USER PROFILE ---\n',
      context.userProfile,
      '\n--- LONG-TERM MEMORY ---\n',
      context.memory,
      context.sessionNotes ? `\n--- SESSION NOTES ---\n${context.sessionNotes}` : '',
      ragContext ? `\n${ragContext}` : '',
      `\n--- ACTIVE REMINDERS ---\n${context.activeReminders}`,
      `\n--- RESPONSE LANGUAGE ---\nRespond in: ${language}. If the user switches language, follow their lead.`,
    ].filter(Boolean).join('\n');

    messages.push({ role: 'system', content: systemContent });

    // 2. Conversation history
    for (const msg of context.recentMessages) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // 3. Current user message
    messages.push({ role: 'user', content: userMessage });

    return messages;
  }
}
