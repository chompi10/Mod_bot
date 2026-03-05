/**
 * @file db/client.ts — Database Client (SQLite)
 * 
 * WHY SQLite for a hackathon:
 * 1. Zero setup — no Docker, no connection strings, just a file
 * 2. ACID-compliant — data integrity without a server
 * 3. Fast enough for single-server deployment
 * 4. Easy to migrate to Postgres later (SQL is SQL)
 * 
 * TRADEOFF: SQLite is single-writer. For production with multiple
 * server instances, migrate to PostgreSQL or use SQLite with Litestream
 * for replication.
 * 
 * PATTERN: Repository pattern — each entity gets CRUD methods.
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { User, HealthRecord, Conversation, Message, MemoryEntry, SchemeApplication } from './schema.js';

const log = createLogger('Database');

// ─── Database Initialization ────────────────────────────────────
// WHY: We create the DB and tables at import time so the app is
// immediately ready to serve requests. Migration-style table creation
// uses IF NOT EXISTS to be safely re-runnable.

import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Ensure the data directory exists
mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });

const db: DatabaseType = new Database(config.DATABASE_PATH);

// WHY: WAL mode gives us better concurrent read performance.
// This is critical when the heartbeat system reads while a webhook writes.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema Creation ────────────────────────────────────────────
db.exec(`
  -- Users table: core identity for each WhatsApp user
  CREATE TABLE IF NOT EXISTS users (
    whatsapp_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Unknown',
    location_lat REAL,
    location_lng REAL,
    language TEXT NOT NULL DEFAULT 'english' CHECK(language IN ('tamil','hindi','english')),
    emergency_contacts TEXT NOT NULL DEFAULT '[]',  -- JSON array
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Health records: one per user, stores medical profile
  CREATE TABLE IF NOT EXISTS health_records (
    user_id TEXT PRIMARY KEY REFERENCES users(whatsapp_id),
    medical_history TEXT NOT NULL DEFAULT '[]',
    allergies TEXT NOT NULL DEFAULT '[]',
    current_medications TEXT NOT NULL DEFAULT '[]',
    appointments TEXT NOT NULL DEFAULT '[]',
    vitals TEXT NOT NULL DEFAULT '{}',
    last_updated TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Conversations: session-based message history
  CREATE TABLE IF NOT EXISTS conversations (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(whatsapp_id),
    active_agent TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_activity TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Messages: individual messages within conversations
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES conversations(session_id),
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'english',
    media TEXT,  -- JSON: { type, url, transcription, mime_type }
    metadata TEXT,  -- JSON: arbitrary metadata
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Memory entries: structured memories for recall
  CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(whatsapp_id),
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    relevance_score REAL DEFAULT 1.0
  );

  -- Scheme applications: government scheme tracking
  CREATE TABLE IF NOT EXISTS scheme_applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(whatsapp_id),
    scheme_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','submitted','approved','rejected')),
    documents TEXT NOT NULL DEFAULT '[]',
    application_date TEXT NOT NULL DEFAULT (datetime('now')),
    last_updated TEXT NOT NULL DEFAULT (datetime('now')),
    tracking_id TEXT
  );

  -- Indexes for common queries
  -- WHY: These indexes make the most frequent queries fast:
  -- 1. Looking up messages by session (conversation history)
  -- 2. Finding memories by user and category (context assembly)
  -- 3. Finding recent messages (RAG indexing)
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_memory_user_cat ON memory_entries(user_id, category);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
`);

log.info('Database initialized', { path: config.DATABASE_PATH });

// ─── User Repository ────────────────────────────────────────────
export const UserRepo = {
  /**
   * Find or create a user. Called on every incoming WhatsApp message.
   * WHY: We use INSERT OR IGNORE + SELECT to handle the race condition
   * where two messages arrive simultaneously for a new user.
   */
  findOrCreate(whatsappId: string, name?: string): User {
    db.prepare(`
      INSERT OR IGNORE INTO users (whatsapp_id, name) VALUES (?, ?)
    `).run(whatsappId, name ?? 'Unknown');

    const row = db.prepare('SELECT * FROM users WHERE whatsapp_id = ?').get(whatsappId) as any;

    return {
      whatsapp_id: row.whatsapp_id,
      name: row.name,
      location: row.location_lat ? { lat: row.location_lat, lng: row.location_lng } : null,
      language: row.language,
      emergency_contacts: JSON.parse(row.emergency_contacts),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  },

  update(whatsappId: string, updates: Partial<Pick<User, 'name' | 'location' | 'language' | 'emergency_contacts'>>) {
    const sets: string[] = [];
    const values: any[] = [];

    if (updates.name) { sets.push('name = ?'); values.push(updates.name); }
    if (updates.location) {
      sets.push('location_lat = ?, location_lng = ?');
      values.push(updates.location.lat, updates.location.lng);
    }
    if (updates.language) { sets.push('language = ?'); values.push(updates.language); }
    if (updates.emergency_contacts) {
      sets.push('emergency_contacts = ?');
      values.push(JSON.stringify(updates.emergency_contacts));
    }

    if (sets.length === 0) return;

    sets.push("updated_at = datetime('now')");
    values.push(whatsappId);

    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE whatsapp_id = ?`).run(...values);
  },
};

// ─── Conversation Repository ────────────────────────────────────
export const ConversationRepo = {
  /**
   * Get or create an active session for a user.
   * 
   * WHY: Sessions expire after 30 minutes of inactivity. This prevents
   * the bot from carrying stale context into a new conversation topic.
   * A user asking about headaches at 9am shouldn't get that context
   * when they ask about government schemes at 3pm.
   */
  getActiveSession(userId: string): Conversation {
    const SESSION_TIMEOUT_MINUTES = 30;

    // Try to find a recent session
    const row = db.prepare(`
      SELECT * FROM conversations 
      WHERE user_id = ? 
        AND datetime(last_activity) > datetime('now', ?)
      ORDER BY last_activity DESC 
      LIMIT 1
    `).get(userId, `-${SESSION_TIMEOUT_MINUTES} minutes`) as any;

    if (row) {
      return {
        session_id: row.session_id,
        user_id: row.user_id,
        messages: [],  // Loaded separately for efficiency
        active_agent: row.active_agent,
        created_at: new Date(row.created_at),
        last_activity: new Date(row.last_activity),
      };
    }

    // Create new session
    const sessionId = uuidv4();
    db.prepare(`
      INSERT INTO conversations (session_id, user_id) VALUES (?, ?)
    `).run(sessionId, userId);

    return {
      session_id: sessionId,
      user_id: userId,
      messages: [],
      active_agent: 'general',
      created_at: new Date(),
      last_activity: new Date(),
    };
  },

  /** Update which agent is handling the conversation */
  setActiveAgent(sessionId: string, agent: string) {
    db.prepare(`
      UPDATE conversations SET active_agent = ?, last_activity = datetime('now')
      WHERE session_id = ?
    `).run(agent, sessionId);
  },
};

// ─── Message Repository ─────────────────────────────────────────
export const MessageRepo = {
  /**
   * Save a message and return its ID.
   */
  save(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): string {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, language, media, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      message.role,
      message.content,
      message.language,
      message.media ? JSON.stringify(message.media) : null,
      message.metadata ? JSON.stringify(message.metadata) : null,
    );

    // Update session last_activity
    db.prepare(`
      UPDATE conversations SET last_activity = datetime('now') WHERE session_id = ?
    `).run(sessionId);

    return id;
  },

  /**
   * Get recent messages for a session.
   * 
   * WHY: We limit to `limit` messages to control context window size.
   * The LLM has a finite context window, and stuffing 1000 messages
   * in would waste tokens and slow responses.
   */
  getRecent(sessionId: string, limit = 20): Message[] {
    const rows = db.prepare(`
      SELECT * FROM messages 
      WHERE session_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(sessionId, limit) as any[];

    return rows.reverse().map((row: any) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      language: row.language,
      media: row.media ? JSON.parse(row.media) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      timestamp: new Date(row.timestamp),
    }));
  },

  /**
   * Get recent messages across ALL sessions for a user.
   * WHY: Used by the RAG indexer to build the user's knowledge base.
   */
  getRecentByUser(userId: string, limit = 200): Message[] {
    const rows = db.prepare(`
      SELECT m.* FROM messages m
      JOIN conversations c ON m.session_id = c.session_id
      WHERE c.user_id = ?
      ORDER BY m.timestamp DESC
      LIMIT ?
    `).all(userId, limit) as any[];

    return rows.reverse().map((row: any) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      language: row.language,
      media: row.media ? JSON.parse(row.media) : undefined,
      timestamp: new Date(row.timestamp),
    }));
  },
};

// ─── Memory Repository ──────────────────────────────────────────
export const MemoryRepo = {
  save(entry: Omit<MemoryEntry, 'id' | 'created_at'>): string {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO memory_entries (id, user_id, content, category, source, relevance_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, entry.user_id, entry.content, entry.category, entry.source, entry.relevance_score ?? 1.0);
    return id;
  },

  /**
   * Search memories by user and optional category.
   * WHY: Category filtering narrows results (e.g., only health memories
   * when the user asks about their prescriptions).
   */
  search(userId: string, category?: string, limit = 10): MemoryEntry[] {
    const query = category
      ? `SELECT * FROM memory_entries WHERE user_id = ? AND category = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM memory_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`;
    
    const params = category ? [userId, category, limit] : [userId, limit];
    const rows = db.prepare(query).all(...params) as any[];

    return rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      content: row.content,
      category: row.category,
      source: row.source,
      created_at: new Date(row.created_at),
      relevance_score: row.relevance_score,
    }));
  },
};

// ─── Health Record Repository ───────────────────────────────────
export const HealthRepo = {
  getOrCreate(userId: string): HealthRecord {
    db.prepare(`
      INSERT OR IGNORE INTO health_records (user_id) VALUES (?)
    `).run(userId);

    const row = db.prepare('SELECT * FROM health_records WHERE user_id = ?').get(userId) as any;
    return {
      user_id: row.user_id,
      medical_history: JSON.parse(row.medical_history),
      allergies: JSON.parse(row.allergies),
      current_medications: JSON.parse(row.current_medications),
      appointments: JSON.parse(row.appointments),
      vitals: JSON.parse(row.vitals),
      last_updated: new Date(row.last_updated),
    };
  },

  update(userId: string, updates: Partial<HealthRecord>) {
    const sets: string[] = [];
    const values: any[] = [];

    if (updates.medical_history) { sets.push('medical_history = ?'); values.push(JSON.stringify(updates.medical_history)); }
    if (updates.allergies) { sets.push('allergies = ?'); values.push(JSON.stringify(updates.allergies)); }
    if (updates.current_medications) { sets.push('current_medications = ?'); values.push(JSON.stringify(updates.current_medications)); }
    if (updates.appointments) { sets.push('appointments = ?'); values.push(JSON.stringify(updates.appointments)); }
    if (updates.vitals) { sets.push('vitals = ?'); values.push(JSON.stringify(updates.vitals)); }

    if (sets.length === 0) return;
    sets.push("last_updated = datetime('now')");
    values.push(userId);

    db.prepare(`UPDATE health_records SET ${sets.join(', ')} WHERE user_id = ?`).run(...values);
  },
};

export { db };
