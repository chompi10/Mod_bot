/**
 * @file agents/orchestrator.ts — Agent Orchestrator
 * 
 * WHY: Users send unstructured messages. The orchestrator's job is to:
 * 1. Detect emergency keywords (FAST, rule-based — no LLM needed)
 * 2. Classify intent (which agent should handle this?)
 * 3. Route to the appropriate specialized agent
 * 4. Handle memory updates after the agent responds
 * 
 * PATTERN: "Router + Chain of Responsibility"
 * The orchestrator first checks rules (emergency keywords, menu numbers),
 * then falls back to LLM-based intent classification for ambiguous messages.
 * 
 * FLOW:
 * WhatsApp message → Orchestrator
 *   ├─ Emergency keywords? → EmergencyAgent (FAST PATH, no LLM)
 *   ├─ GitHub keywords?    → GitHubAgent (direct API, no LLM)
 *   ├─ Menu number (1-5)?  → Direct routing
 *   ├─ Active session agent? → Continue with that agent
 *   └─ Ambiguous? → LLM intent classification → Route
 */

import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { healthAgent } from './health.agent.js';
import { schemeAgent } from './scheme.agent.js';
import { educationAgent } from './edu.agent.js';
import { emergencyAgent } from './emergency.agent.js';
import { GitHubAgent } from './github.agent.js';
import { isEmergency } from '../mcp-tools/emergency/index.js';
import { MemoryManager } from '../memory/manager.js';
import { ConversationRepo, MessageRepo, UserRepo } from '../db/client.js';
import { RAGIndexer } from '../rag/indexer.js';
import { detectLanguage } from '../utils/language.js';
import { t } from '../utils/language.js';
import { createLogger } from '../utils/logger.js';
import { detectGitHubIntent } from '../utils/github-intent.js';
import type { BaseAgent, AgentResponse } from './base.agent.js';
import type { Message, User } from '../db/schema.js';

const log = createLogger('Orchestrator');
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// Agent registry (standard agents that extend BaseAgent)
const agents: Record<string, BaseAgent> = {
  health: healthAgent,
  scheme: schemeAgent,
  education: educationAgent,
  emergency: emergencyAgent,
};

// GitHub agent (standalone — uses its own handle() method)
const githubAgent = new GitHubAgent();

/**
 * Main message processing pipeline.
 * Called by the WhatsApp webhook handler for every incoming message.
 */
export async function processMessage(
  whatsappId: string,
  messageText: string,
  mediaUrl?: string
): Promise<string> {
  const startTime = Date.now();

  try {
    // ── Step 1: User & Session Management ───────────────────
    const user = UserRepo.findOrCreate(whatsappId);
    const session = ConversationRepo.getActiveSession(whatsappId);
    const language = await detectLanguage(messageText);

    // Update user language if it changed
    if (language !== user.language) {
      UserRepo.update(whatsappId, { language });
    }

    // ── Step 2: Record incoming message ─────────────────────
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      content: messageText,
      language,
      timestamp: new Date(),
    };

    MessageRepo.save(session.session_id, userMsg);
    MemoryManager.recordUserMessage(session.session_id, whatsappId, userMsg);
    RAGIndexer.queueMessage(userMsg.id, whatsappId, messageText, 'user');

    // ── Step 3: Route to Agent ──────────────────────────────
    let agentName: string;
    let responseText: string;

    // Tier 1: EMERGENCY — fastest path
    if (isEmergency(messageText)) {
      agentName = 'emergency';
      log.warn('Emergency detected', { userId: whatsappId, message: messageText.slice(0, 100) });
    }
    // Tier 1.5: GITHUB — check for GitHub intent before menu/LLM
    else if (detectGitHubIntent(messageText)?.confidence && detectGitHubIntent(messageText)!.confidence > 0.7) {
      log.info('GitHub intent detected', { userId: whatsappId });
      responseText = await githubAgent.handle(whatsappId, messageText, language);
      return await recordAndReturn(session.session_id, whatsappId, responseText, language, startTime);
    }
    // Tier 2: Menu selections and greetings
    else if (/^[1]$/.test(messageText.trim())) {
      agentName = 'health';
    } else if (/^[2]$/.test(messageText.trim())) {
      agentName = 'scheme';
    } else if (/^[3]$/.test(messageText.trim())) {
      agentName = 'education';
    } else if (/^[4]$/.test(messageText.trim())) {
      agentName = 'emergency';
    } else if (/^[5]$/.test(messageText.trim())) {
      // Menu option 5 → GitHub
      responseText = await githubAgent.handle(whatsappId, messageText, language);
      return await recordAndReturn(session.session_id, whatsappId, responseText, language, startTime);
    } else if (/^(hi|hello|hey|menu|start|vanakkam|namaste)\b/i.test(messageText.trim())) {
      // Greeting — show menu (now includes GitHub option)
      responseText = t('greeting', language) + '\n\n' + t('menu', language);
      return await recordAndReturn(session.session_id, whatsappId, responseText, language, startTime);
    }
    // Tier 3: Continue with active agent or classify
    else if (session.active_agent !== 'general') {
      agentName = session.active_agent;
    } else {
      agentName = await classifyIntent(messageText);
    }

    // ── Step 4: Execute Agent ───────────────────────────────
    // Handle GitHub routing from classifier
    if (agentName === 'github') {
      responseText = await githubAgent.handle(whatsappId, messageText, language);
      return await recordAndReturn(session.session_id, whatsappId, responseText, language, startTime);
    }

    ConversationRepo.setActiveAgent(session.session_id, agentName);
    const agent = agents[agentName];

    if (!agent) {
      responseText = t('error_generic', language);
      return await recordAndReturn(session.session_id, whatsappId, responseText, language, startTime);
    }

    const agentResponse = await agent.process(
      whatsappId,
      session.session_id,
      messageText,
      language
    );

    responseText = agentResponse.text;

    // ── Step 5: Post-processing ─────────────────────────────
    for (const note of agentResponse.sessionNotes) {
      MemoryManager.addSessionNote(session.session_id, {
        content: note.content,
        category: note.category as any,
        importance: note.importance,
      });
    }

    for (const update of agentResponse.memoryUpdates) {
      MemoryManager.rememberLongTerm(whatsappId, update.entry, update.category);
    }

    return await recordAndReturn(session.session_id, whatsappId, responseText, language, startTime);

  } catch (error) {
    log.error('Message processing failed', { error, whatsappId });
    return 'I apologize, something went wrong. Please try again or type "menu" for options. For emergencies, call 108 (ambulance) directly.';
  }
}

/**
 * Record bot response and return.
 */
async function recordAndReturn(
  sessionId: string,
  userId: string,
  text: string,
  language: string,
  startTime: number
): Promise<string> {
  const botMsg: Message = {
    id: uuidv4(),
    role: 'assistant',
    content: text,
    language: language as any,
    timestamp: new Date(),
  };

  MessageRepo.save(sessionId, botMsg);
  MemoryManager.recordBotResponse(sessionId, userId, botMsg);
  RAGIndexer.queueMessage(botMsg.id, userId, text, 'assistant');

  log.info('Response sent', {
    userId,
    duration_ms: Date.now() - startTime,
    responseLength: text.length,
  });

  return text;
}

/**
 * LLM-based intent classification.
 * Now includes 'github' as a possible classification.
 */
async function classifyIntent(message: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: `Classify the user's intent into exactly one category. Reply with ONLY the category name.
Categories:
- health: symptoms, illness, doctor, hospital, medication, wellness, pain, fever, disease
- scheme: government scheme, subsidy, insurance, ration card, pension, benefits, application
- education: study, learn, homework, quiz, exam, school, college, math, science, course
- emergency: accident, help, danger, fire, bleeding, unconscious, urgent distress
- github: repository, issue, pull request, commit, merge, branch, workflow, CI/CD, code review
- general: greeting, question, other`,
        },
        { role: 'user', content: message },
      ],
      temperature: 0,
      max_tokens: 20,
    });

    const intent = response.choices[0]?.message?.content?.trim().toLowerCase() ?? 'general';
    
    if (['health', 'scheme', 'education', 'emergency', 'github'].includes(intent)) {
      log.debug('Intent classified', { message: message.slice(0, 50), intent });
      return intent;
    }

    return 'health'; // Default to health as it's the primary use case
  } catch (error) {
    log.error('Intent classification failed', { error });
    return 'health';
  }
}
