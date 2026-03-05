/**
 * @file utils/errors.ts — Custom Error Types
 * 
 * WHY: Generic Error objects lose context. Custom error classes let us:
 * 1. Catch specific error types (e.g., only retry on ToolExecutionError)
 * 2. Attach structured metadata (userId, toolName, etc.)
 * 3. Map errors to user-friendly WhatsApp messages
 * 
 * PATTERN: Error hierarchy — all custom errors extend a base SahAIError.
 */

export class SahAIError extends Error {
  public readonly code: string;
  public readonly isRetryable: boolean;

  constructor(message: string, code: string, isRetryable = false) {
    super(message);
    this.name = 'SahAIError';
    this.code = code;
    this.isRetryable = isRetryable;
  }
}

/** Thrown when an MCP tool fails to execute */
export class ToolExecutionError extends SahAIError {
  public readonly toolName: string;

  constructor(toolName: string, message: string, isRetryable = true) {
    super(`Tool '${toolName}' failed: ${message}`, 'TOOL_EXEC_ERROR', isRetryable);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
  }
}

/** Thrown when the LLM API returns an error or unexpected response */
export class LLMError extends SahAIError {
  constructor(message: string, isRetryable = true) {
    super(message, 'LLM_ERROR', isRetryable);
    this.name = 'LLMError';
  }
}

/** Thrown when memory operations fail */
export class MemoryError extends SahAIError {
  constructor(message: string) {
    super(message, 'MEMORY_ERROR', false);
    this.name = 'MemoryError';
  }
}

/** Thrown when WhatsApp API communication fails */
export class WhatsAppError extends SahAIError {
  constructor(message: string, isRetryable = true) {
    super(message, 'WHATSAPP_ERROR', isRetryable);
    this.name = 'WhatsAppError';
  }
}

/** Thrown for emergency situations that need immediate escalation */
export class EmergencyError extends SahAIError {
  constructor(message: string) {
    // WHY: Emergency errors are NEVER retryable — they need human intervention
    super(message, 'EMERGENCY_ERROR', false);
    this.name = 'EmergencyError';
  }
}

/**
 * Maps errors to user-friendly messages in the user's language.
 * 
 * WHY: Users should never see stack traces or technical errors.
 * This function converts internal errors to compassionate, helpful messages.
 */
export function getUserFriendlyMessage(
  error: Error,
  language: 'english' | 'tamil' | 'hindi' = 'english'
): string {
  const messages: Record<string, Record<string, string>> = {
    TOOL_EXEC_ERROR: {
      english: "I'm having trouble processing that right now. Let me try again.",
      tamil: 'இப்போது செயல்படுத்துவதில் சிக்கல். மீண்டும் முயற்சிக்கிறேன்.',
      hindi: 'अभी इसे प्रोसेस करने में समस्या हो रही है। मैं फिर से कोशिश करता हूँ।',
    },
    LLM_ERROR: {
      english: "I'm experiencing a temporary issue. Please try again in a moment.",
      tamil: 'தற்காலிக சிக்கல் உள்ளது. சிறிது நேரம் கழித்து முயற்சிக்கவும்.',
      hindi: 'एक अस्थायी समस्या है। कृपया कुछ देर बाद पुनः प्रयास करें।',
    },
    EMERGENCY_ERROR: {
      english: '⚠️ Please call 108 (ambulance), 100 (police), or 101 (fire) directly.',
      tamil: '⚠️ நேரடியாக 108 (ஆம்புலன்ஸ்), 100 (காவல்), அல்லது 101 (தீயணைப்பு) அழைக்கவும்.',
      hindi: '⚠️ कृपया सीधे 108 (एम्बुलेंस), 100 (पुलिस), या 101 (दमकल) पर कॉल करें।',
    },
  };

  const code = error instanceof SahAIError ? error.code : 'LLM_ERROR';
  return messages[code]?.[language] ?? messages['LLM_ERROR']![language]!;
}
