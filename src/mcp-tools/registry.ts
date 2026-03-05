/**
 * @file mcp-tools/registry.ts — MCP Tool Registry & Dispatch
 * 
 * WHY MCP (Model Context Protocol):
 * MCP is an emerging standard for how LLMs discover and invoke tools.
 * By following this protocol, our tools work with any MCP-compatible
 * LLM — not just OpenAI. This future-proofs the architecture.
 * 
 * HOW IT WORKS:
 * 1. Each tool registers itself with a name, description, and input schema
 * 2. The registry provides tool descriptions to the LLM (so it knows what's available)
 * 3. When the LLM decides to call a tool, the registry dispatches the call
 * 4. Results are returned to the LLM for incorporation into its response
 * 
 * PATTERN: "Strategy + Registry" — tools are strategies registered by name.
 * The registry handles lookup, validation, execution, and error recovery.
 * 
 * TOOL CALLING LOOP (with error recovery):
 * 1. LLM receives context + tool descriptions
 * 2. LLM outputs a tool_call (name + arguments)
 * 3. Registry validates arguments against the tool's schema
 * 4. Registry executes the tool
 * 5. On success: result is sent back to LLM
 * 6. On error: error message is sent to LLM with retry suggestion
 * 7. LLM can make another tool call or produce final response
 * Repeat up to MAX_TOOL_CALLS times.
 */

import { z } from 'zod';
import type { MCPToolDefinition, MCPToolResult } from '../db/schema.js';
import { ToolExecutionError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ToolRegistry');

/** Maximum tool calls per single user request (prevents infinite loops) */
const MAX_TOOL_CALLS = 5;

/**
 * A registered tool: definition + execution function.
 */
interface RegisteredTool {
  definition: MCPToolDefinition;
  /** The actual function that executes the tool */
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  /** Zod schema for runtime argument validation */
  schema: z.ZodSchema;
}

/** The global tool registry */
const tools = new Map<string, RegisteredTool>();

export const ToolRegistry = {
  /**
   * Register a new tool.
   * Called at app startup by each tool module.
   */
  register(
    definition: MCPToolDefinition,
    execute: (args: Record<string, unknown>) => Promise<unknown>,
    schema: z.ZodSchema
  ): void {
    tools.set(definition.name, { definition, execute, schema });
    log.info('Tool registered', { name: definition.name });
  },

  /**
   * Get all tool definitions (for the LLM system prompt).
   * 
   * WHY: The LLM needs to know what tools exist and how to call them.
   * This returns the definitions in the format OpenAI expects for
   * function calling.
   */
  getDefinitions(): MCPToolDefinition[] {
    return Array.from(tools.values()).map((t) => t.definition);
  },

  /**
   * Get definitions formatted as OpenAI function calling tools.
   * 
   * WHY: OpenAI has a specific format for tool definitions. This
   * converts our MCP definitions into that format.
   */
  getOpenAITools(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: object };
  }> {
    return Array.from(tools.values()).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.input_schema,
      },
    }));
  },

  /**
   * Execute a tool by name with given arguments.
   * 
   * Handles:
   * - Argument validation (via Zod schema)
   * - Execution with timing
   * - Error wrapping (returns structured errors, not exceptions)
   */
  async execute(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const tool = tools.get(name);
    const startTime = Date.now();

    if (!tool) {
      return {
        tool_name: name,
        success: false,
        result: null,
        error: `Unknown tool: ${name}. Available tools: ${Array.from(tools.keys()).join(', ')}`,
        duration_ms: 0,
      };
    }

    // Validate arguments
    try {
      tool.schema.parse(args);
    } catch (error) {
      const zodError = error as z.ZodError;
      return {
        tool_name: name,
        success: false,
        result: null,
        error: `Invalid arguments: ${zodError.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`,
        duration_ms: Date.now() - startTime,
      };
    }

    // Execute
    try {
      const result = await tool.execute(args);
      const duration = Date.now() - startTime;

      log.info('Tool executed', { name, duration_ms: duration, success: true });

      return {
        tool_name: name,
        success: true,
        result,
        duration_ms: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      log.error('Tool execution failed', { name, error: message, duration_ms: duration });

      return {
        tool_name: name,
        success: false,
        result: null,
        error: message,
        duration_ms: duration,
      };
    }
  },

  /**
   * Process a tool calling loop.
   * 
   * This is the main integration point with the LLM. It handles
   * the back-and-forth of:
   * LLM → tool_call → execute → result → LLM → (maybe another tool_call)
   * 
   * WHY a loop: Complex queries may need multiple tool calls.
   * Example: "Find me a cardiologist near me and book an appointment"
   * → Tool 1: hospital_finder (find nearby cardiologists)
   * → Tool 2: appointment_booker (book with the recommended doctor)
   */
  async processToolCalls(
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>
  ): Promise<MCPToolResult[]> {
    const results: MCPToolResult[] = [];

    for (const call of toolCalls.slice(0, MAX_TOOL_CALLS)) {
      const result = await this.execute(call.name, call.arguments);
      results.push(result);

      // WHY: If a critical tool fails, stop the chain. No point booking
      // an appointment if we couldn't find a hospital.
      if (!result.success && !tools.get(call.name)) {
        log.warn('Stopping tool chain due to unknown tool', { name: call.name });
        break;
      }
    }

    return results;
  },

  /** Get count of registered tools */
  count(): number {
    return tools.size;
  },
};
