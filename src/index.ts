/**
 * @file index.ts — SahAI Application Entry Point
 * 
 * WHY THIS FILE EXISTS:
 * This is the "main" function of SahAI. It:
 * 1. Starts the Express HTTP server (for WhatsApp webhooks)
 * 2. Registers all MCP tools
 * 3. Starts background systems (heartbeat, RAG indexer)
 * 4. Handles graceful shutdown
 * 
 * STARTUP ORDER MATTERS:
 * 1. Config loads first (validates environment)
 * 2. Database initializes (creates tables)
 * 3. MCP tools register (makes them available to agents)
 * 4. Express server starts (begins accepting webhooks)
 * 5. Background systems start (heartbeat, RAG indexer)
 * 
 * WHY this order: Each step depends on the previous one.
 * Tools need the database. The server needs tools.
 * Background systems need the server running.
 */

import express from 'express';
import { config } from './config/index.js';
import { createLogger } from './utils/logger.js';

// WHY: Import tool modules to trigger their self-registration
// Each tool file calls ToolRegistry.register() at import time.
import './mcp-tools/healthcare/index.js';
import './mcp-tools/government/index.js';
import './mcp-tools/education/index.js';
import './mcp-tools/emergency/index.js';
import './mcp-tools/github/index.js';

import { ToolRegistry } from './mcp-tools/registry.js';
import { webhookRouter } from './whatsapp/webhook.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { HeartbeatManager } from './memory/heartbeat.js';
import { RAGIndexer } from './rag/indexer.js';

const log = createLogger('App');

// ─── Express App Setup ──────────────────────────────────────────
const app = express();

// WHY: Twilio sends form-encoded data for webhooks
app.use(express.urlencoded({ extended: true }));
// WHY: Also support JSON for API clients and testing
app.use(express.json());

// Mount the webhook router
app.use(webhookRouter);

// Root route — useful for verifying deployment
app.get('/', (_req, res) => {
  res.json({
    name: 'SahAI — WhatsApp Healthcare Assistant',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      webhook: '/api/webhook',
      health: '/api/health',
    },
    tools_registered: ToolRegistry.count(),
  });
});

// ─── Start Server ───────────────────────────────────────────────
const server = app.listen(config.PORT, () => {
  log.info(`SahAI server started`, {
    port: config.PORT,
    env: config.NODE_ENV,
    tools: ToolRegistry.count(),
    webhookUrl: `${config.WEBHOOK_BASE_URL}/api/webhook`,
  });

  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║                                                  ║
  ║   🏥 SahAI — WhatsApp Healthcare Assistant       ║
  ║                                                  ║
  ║   Server:  http://localhost:${config.PORT}              ║
  ║   Webhook: ${config.WEBHOOK_BASE_URL}/api/webhook      
  ║   Tools:   ${ToolRegistry.count()} registered                    ║
  ║   Env:     ${config.NODE_ENV}                        
  ║                                                  ║
  ╚══════════════════════════════════════════════════╝
  `);
});

// ─── Start Background Systems ───────────────────────────────────

// Heartbeat: periodic reminders and cleanup
HeartbeatManager.start(async (userId: string, message: string) => {
  await WhatsAppClient.sendText(userId, message);
});

// RAG Indexer: background message embedding
RAGIndexer.start();

log.info('Background systems started', {
  heartbeat: `every ${config.HEARTBEAT_INTERVAL_MS / 1000}s`,
  ragIndexer: `every ${config.RAG_INDEX_INTERVAL_MS / 1000}s`,
});

// ─── Graceful Shutdown ──────────────────────────────────────────
// WHY: When the process is killed (SIGTERM from Docker, Ctrl+C),
// we want to:
// 1. Stop accepting new requests
// 2. Finish processing in-flight requests
// 3. Stop background systems
// 4. Close database connections
// Without this, in-flight messages could be lost.

function shutdown(signal: string) {
  log.info(`Received ${signal}, shutting down gracefully...`);

  // Stop background systems
  HeartbeatManager.stop();
  RAGIndexer.stop();

  // Close HTTP server (stop accepting new connections)
  server.close(() => {
    log.info('Server closed. Goodbye!');
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    log.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
