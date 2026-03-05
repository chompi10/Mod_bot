/**
 * @file memory/heartbeat.ts — Heartbeat System
 * 
 * WHY: A healthcare bot can't be purely reactive. It needs to PROACTIVELY:
 * 1. Send medication reminders at scheduled times
 * 2. Follow up on health check-ins
 * 3. Remind about upcoming appointments
 * 4. Clean up stale memory
 * 
 * PATTERN: "Heartbeat" — periodic timer checks heartbeat-state.json
 * and triggers actions based on timestamps.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { ShortTermMemory } from './short-term.js';
import { WorkingMemory } from './working.js';

const log = createLogger('Heartbeat');

interface HeartbeatState {
  last_check: string;
  reminders: Record<string, ScheduledReminder[]>;
  follow_ups: Record<string, string>;
}

export interface ScheduledReminder {
  id: string;
  type: 'medication' | 'appointment' | 'check_in' | 'custom';
  message: string;
  schedule: string;
  last_sent?: string;
  recurring: boolean;
}

const STATE_PATH = join(config.MEMORY_DIR, 'heartbeat-state.json');

function readState(): HeartbeatState {
  if (!existsSync(STATE_PATH)) {
    return { last_check: new Date().toISOString(), reminders: {}, follow_ups: {} };
  }
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}

function writeState(state: HeartbeatState): void {
  mkdirSync(config.MEMORY_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

export const HeartbeatManager = {
  _intervalId: null as NodeJS.Timeout | null,

  start(sendMessageFn: (userId: string, message: string) => Promise<void>): void {
    log.info('Starting heartbeat system', { intervalMs: config.HEARTBEAT_INTERVAL_MS });

    this._intervalId = setInterval(async () => {
      try { await this.tick(sendMessageFn); }
      catch (err) { log.error('Heartbeat tick failed', { error: err }); }
    }, config.HEARTBEAT_INTERVAL_MS);

    this.tick(sendMessageFn).catch((err) => log.error('Initial tick failed', { error: err }));
  },

  stop(): void {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      log.info('Heartbeat stopped');
    }
  },

  async tick(sendMessageFn: (userId: string, message: string) => Promise<void>): Promise<void> {
    const state = readState();
    const now = new Date();
    log.debug('Heartbeat tick', { lastCheck: state.last_check });

    // 1. Check for due reminders
    for (const [userId, reminders] of Object.entries(state.reminders)) {
      for (const reminder of reminders) {
        if (this.isDue(reminder, now)) {
          try {
            await sendMessageFn(userId, reminder.message);
            reminder.last_sent = now.toISOString();
            log.info('Reminder sent', { userId, type: reminder.type, id: reminder.id });
          } catch (err) {
            log.error('Failed to send reminder', { userId, error: err });
          }
        }
      }
      // Remove non-recurring reminders that have been sent
      state.reminders[userId] = reminders.filter(
        (r) => r.recurring || !r.last_sent
      );
    }

    // 2. Garbage-collect stale in-memory buffers
    ShortTermMemory.gc();
    WorkingMemory.gc();

    // 3. Update state
    state.last_check = now.toISOString();
    writeState(state);
  },

  /**
   * Check if a reminder is due.
   * For non-recurring: due if schedule timestamp has passed and not yet sent.
   * For recurring: due if enough time has passed since last_sent.
   */
  isDue(reminder: ScheduledReminder, now: Date): boolean {
    if (!reminder.recurring) {
      if (reminder.last_sent) return false;
      const scheduleTime = new Date(reminder.schedule);
      return now >= scheduleTime;
    }
    // Recurring: parse cron-like interval (simplified for hackathon)
    if (!reminder.last_sent) return true;
    const lastSent = new Date(reminder.last_sent);
    const intervalMs = this.parseCronInterval(reminder.schedule);
    return now.getTime() - lastSent.getTime() >= intervalMs;
  },

  /**
   * Simplified cron interval parser.
   * HACKATHON NOTE: In production, use node-cron for proper cron parsing.
   * This handles common patterns: "8h" (every 8 hours), "12h", "24h"
   */
  parseCronInterval(schedule: string): number {
    const match = schedule.match(/(\d+)([hmd])/);
    if (!match) return 24 * 60 * 60 * 1000; // Default: daily
    const [, num, unit] = match;
    const multiplier = { h: 3600000, m: 60000, d: 86400000 };
    return parseInt(num!) * (multiplier[unit as keyof typeof multiplier] ?? 86400000);
  },

  // ─── Reminder Management ─────────────────────────────────────

  addReminder(userId: string, reminder: ScheduledReminder): void {
    const state = readState();
    if (!state.reminders[userId]) state.reminders[userId] = [];
    state.reminders[userId]!.push(reminder);
    writeState(state);
    log.info('Reminder added', { userId, type: reminder.type, id: reminder.id });
  },

  removeReminder(userId: string, reminderId: string): void {
    const state = readState();
    if (state.reminders[userId]) {
      state.reminders[userId] = state.reminders[userId]!.filter((r) => r.id !== reminderId);
      writeState(state);
    }
  },

  getReminders(userId: string): ScheduledReminder[] {
    const state = readState();
    return state.reminders[userId] ?? [];
  },

  addFollowUp(userId: string, when: Date): void {
    const state = readState();
    state.follow_ups[userId] = when.toISOString();
    writeState(state);
  },
};
