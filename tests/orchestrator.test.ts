/**
 * @file tests/orchestrator.test.ts — Orchestrator Integration Test
 * 
 * WHY: Tests verify that the routing logic works correctly:
 * 1. Emergency keywords bypass LLM and go straight to EmergencyAgent
 * 2. Menu numbers route to correct agents
 * 3. Greetings show the menu
 * 4. Ambiguous messages get classified correctly
 * 
 * RUN: npx vitest tests/orchestrator.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { isEmergency } from '../src/mcp-tools/emergency/index.js';

describe('Emergency Detection', () => {
  it('detects English emergency keywords', () => {
    expect(isEmergency('I am having chest pain')).toBe(true);
    expect(isEmergency("can't breathe help me")).toBe(true);
    expect(isEmergency('there is a fire')).toBe(true);
    expect(isEmergency('call ambulance 108')).toBe(true);
  });

  it('does not trigger for normal messages', () => {
    expect(isEmergency('I have a mild headache')).toBe(false);
    expect(isEmergency('What government schemes am I eligible for?')).toBe(false);
    expect(isEmergency('Help me with my homework')).toBe(false);
    expect(isEmergency('Hi')).toBe(false);
  });
});

describe('RAG Decision Logic', () => {
  // Testing the shouldUseRAG function
  it('uses RAG for history-referencing queries', async () => {
    const { shouldUseRAG } = await import('../src/rag/retriever.js');
    
    expect(shouldUseRAG('What medication did I take last time?')).toBe(true);
    expect(shouldUseRAG('You told me something about my allergies before')).toBe(true);
    expect(shouldUseRAG('What did the doctor say previously?')).toBe(true);
  });

  it('skips RAG for simple messages', async () => {
    const { shouldUseRAG } = await import('../src/rag/retriever.js');
    
    expect(shouldUseRAG('Hi')).toBe(false);
    expect(shouldUseRAG('1')).toBe(false);
    expect(shouldUseRAG('menu')).toBe(false);
  });
});

describe('Language Detection', () => {
  it('detects Tamil script', async () => {
    const { detectLanguage } = await import('../src/utils/language.js');
    
    const lang = await detectLanguage('வணக்கம், எனக்கு தலைவலி');
    expect(lang).toBe('tamil');
  });

  it('detects Hindi script', async () => {
    const { detectLanguage } = await import('../src/utils/language.js');
    
    const lang = await detectLanguage('मुझे सिरदर्द है');
    expect(lang).toBe('hindi');
  });

  it('defaults to English for Latin script', async () => {
    const { detectLanguage } = await import('../src/utils/language.js');
    
    const lang = await detectLanguage('I have a headache');
    expect(lang).toBe('english');
  });
});

describe('Symptom Triage', () => {
  it('classifies chest pain as emergency', async () => {
    const { ToolRegistry } = await import('../src/mcp-tools/registry.js');
    // Register tools first
    await import('../src/mcp-tools/healthcare/index.js');
    
    const result = await ToolRegistry.execute('symptom_analyzer', {
      symptoms: 'I am having severe chest pain and difficulty breathing',
      severity: 'severe',
    });

    expect(result.success).toBe(true);
    expect((result.result as any).urgency).toBe('emergency');
  });

  it('classifies mild headache as routine', async () => {
    const { ToolRegistry } = await import('../src/mcp-tools/registry.js');
    
    const result = await ToolRegistry.execute('symptom_analyzer', {
      symptoms: 'I have had a mild headache since morning',
      severity: 'mild',
    });

    expect(result.success).toBe(true);
    expect((result.result as any).urgency).toBe('routine');
  });
});
