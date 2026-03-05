/**
 * @file utils/logger.ts — Structured Logging
 * 
 * WHY: console.log is fine for quick debugging, but in production you need:
 * 1. Log levels (debug/info/warn/error) to filter noise
 * 2. Structured JSON output for log aggregation services
 * 3. Timestamps for debugging timing issues
 * 4. Context (userId, sessionId) to trace a user's journey
 * 
 * PATTERN: Singleton logger with child loggers for per-module context.
 */

import winston from 'winston';
import { config } from '../config/index.js';

const logger = winston.createLogger({
  // WHY: In development we want verbose output; in production only warn+error
  level: config.NODE_ENV === 'development' ? 'debug' : 'info',
  
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    // WHY: JSON format makes logs parseable by tools like Datadog, ELK, etc.
    config.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
            return `${timestamp} [${level}] ${message} ${metaStr}`;
          })
        )
  ),
  
  transports: [new winston.transports.Console()],
});

/**
 * Create a child logger with a fixed module name.
 * Usage: const log = createLogger('HealthAgent');
 *        log.info('Analyzing symptoms', { userId: '123' });
 */
export function createLogger(module: string) {
  return logger.child({ module });
}

export { logger };
