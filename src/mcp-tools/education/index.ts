/**
 * @file mcp-tools/education/index.ts — Education MCP Tools
 * 
 * WHY: WhatsApp is the most accessible app in rural India. By
 * delivering educational content through WhatsApp, we reach students
 * who may not have access to dedicated learning apps or stable internet.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ToolRegistry } from '../registry.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('EducationTools');

// ─── 1. Content Retriever ───────────────────────────────────────
ToolRegistry.register(
  {
    name: 'content_retriever',
    description: 'Fetch educational content on a topic. Returns explanations suitable for WhatsApp delivery.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic to learn about (e.g., "photosynthesis", "quadratic equations")' },
        level: { type: 'string', description: 'Education level: primary, secondary, higher_secondary, college', enum: ['primary', 'secondary', 'higher_secondary', 'college'] },
        language: { type: 'string', description: 'Language: english, tamil, hindi' },
      },
      required: ['topic'],
    },
  },
  async (args) => {
    const { topic, level, language } = args as Record<string, string>;
    // HACKATHON NOTE: In production, integrate with DIKSHA/NCERT content APIs
    return {
      topic,
      level: level || 'secondary',
      content: `[This would contain curated educational content about "${topic}" at the ${level || 'secondary'} level. In production, this fetches from DIKSHA, NCERT, or Khan Academy APIs.]`,
      suggested_resources: [
        { type: 'video', title: `Learn ${topic} - Visual Guide`, url: 'https://example.com/video' },
        { type: 'pdf', title: `${topic} - Study Notes`, url: 'https://example.com/notes.pdf' },
      ],
      next_steps: `Would you like me to quiz you on ${topic}?`,
    };
  },
  z.object({ topic: z.string(), level: z.string().optional(), language: z.string().optional() })
);

// ─── 2. Quiz Generator ─────────────────────────────────────────
ToolRegistry.register(
  {
    name: 'quiz_generator',
    description: 'Generate an interactive quiz on a topic. Returns questions one at a time for WhatsApp interaction.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic for the quiz' },
        difficulty: { type: 'string', description: 'easy, medium, hard', enum: ['easy', 'medium', 'hard'] },
        num_questions: { type: 'string', description: 'Number of questions (1-10)' },
      },
      required: ['topic'],
    },
  },
  async (args) => {
    const { topic, difficulty, num_questions } = args as Record<string, string>;
    const count = Math.min(parseInt(num_questions || '3'), 10);

    // HACKATHON NOTE: In production, use LLM to generate questions dynamically
    return {
      quiz_id: uuidv4().slice(0, 8),
      topic,
      difficulty: difficulty || 'medium',
      total_questions: count,
      instruction: 'I\'ll send you one question at a time. Reply with the option number (1, 2, 3, or 4).',
      sample_question: {
        question_number: 1,
        question: `[Sample question about ${topic}]`,
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        hint: 'Think about the fundamental concepts we discussed.',
      },
    };
  },
  z.object({ topic: z.string(), difficulty: z.string().optional(), num_questions: z.string().optional() })
);

// ─── 3. Progress Tracker ────────────────────────────────────────
ToolRegistry.register(
  {
    name: 'progress_tracker',
    description: 'Track and retrieve learning progress for a user.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User WhatsApp ID' },
        action: { type: 'string', description: '"get" to view or "update" to log progress', enum: ['get', 'update'] },
        topic: { type: 'string', description: 'Topic being studied' },
        score: { type: 'string', description: 'Quiz score (for update action)' },
      },
      required: ['user_id', 'action'],
    },
  },
  async (args) => {
    const { user_id, action, topic, score } = args as Record<string, string>;

    if (action === 'get') {
      return {
        user_id,
        topics_studied: ['Photosynthesis', 'Algebra Basics'],
        quizzes_taken: 5,
        average_score: 72,
        streak_days: 3,
        next_suggestion: 'You\'re doing great! Try the next topic: Cell Biology',
      };
    }

    return {
      status: 'progress_updated',
      topic: topic || 'General',
      score: score || 'N/A',
      encouragement: '🌟 Great job keeping up with your studies!',
    };
  },
  z.object({ user_id: z.string(), action: z.enum(['get', 'update']), topic: z.string().optional(), score: z.string().optional() })
);

// ─── 4. Resource Fetcher ────────────────────────────────────────
ToolRegistry.register(
  {
    name: 'resource_fetcher',
    description: 'Deliver educational PDF, video, or document resources via WhatsApp.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic to find resources for' },
        resource_type: { type: 'string', description: 'Type: pdf, video, worksheet', enum: ['pdf', 'video', 'worksheet'] },
        level: { type: 'string', description: 'Education level' },
      },
      required: ['topic'],
    },
  },
  async (args) => {
    const { topic, resource_type } = args as Record<string, string>;
    return {
      topic,
      resources: [
        {
          title: `${topic} - Complete Study Guide`,
          type: resource_type || 'pdf',
          url: `https://example.com/resources/${topic.replace(/\s+/g, '-').toLowerCase()}.pdf`,
          size: '2.3 MB',
          description: `Comprehensive study material on ${topic}`,
        },
      ],
      note: 'Resources will be sent as WhatsApp documents.',
    };
  },
  z.object({ topic: z.string(), resource_type: z.string().optional(), level: z.string().optional() })
);

log.info('Education tools registered', { count: 4 });
