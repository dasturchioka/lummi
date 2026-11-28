import { pino } from 'pino';

/**
 * Structured logs (pino JSON on stdout, ADR 0024). The userbot logs message ids, outcomes and
 * error codes only: never a message's text (a Humo message can carry a balance or a code), never
 * the session string or a key.
 */
export interface Logger {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
}

export function createLogger(level: string): Logger {
  return pino({
    name: 'userbot',
    level,
    // Belt and braces: these keys are never logged on purpose; if one ever is, it is censored.
    redact: {
      paths: ['text', 'session', 'sessionString', 'key', 'secret', '*.text', '*.session'],
      censor: '[redacted]',
    },
  });
}
