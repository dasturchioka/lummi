import { Logger, type LoggerService } from '@nestjs/common';
import { inspect } from 'node:util';

export interface LogEntry {
  level: 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';
  /** The message and every extra argument, objects fully inspected (own props of errors too). */
  text: string;
}

/**
 * Route every Nest log line (any `Logger`, including Nest's own exception handler) to memory.
 * Test apps run with logging off; `stop()` turns it off again. Process-wide, so use it inside one
 * test file only.
 */
export function captureLogs(): { entries: LogEntry[]; stop(): void } {
  const entries: LogEntry[] = [];
  const record =
    (level: LogEntry['level']) =>
    (...args: unknown[]) => {
      const text = args
        .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6, showHidden: true })))
        .join(' ');
      entries.push({ level, text });
    };
  const logger: LoggerService = {
    log: record('log'),
    error: record('error'),
    warn: record('warn'),
    debug: record('debug'),
    verbose: record('verbose'),
    fatal: record('fatal'),
  };
  Logger.overrideLogger(logger);
  return { entries, stop: () => Logger.overrideLogger(false) };
}
