import type { LoggerService } from '@nestjs/common';
import { pino, type DestinationStream, type Logger as Pino } from 'pino';

/**
 * Nest's logger as one JSON line per event on stdout (pino); Docker's json-file driver rotates it.
 * Nest passes the context («Bot», «ExceptionsHandler») as the last string argument.
 * Messages are already scrubbed by the callers (describeError, SafeExceptionFilter).
 */
export class PinoLogger implements LoggerService {
  private readonly pino: Pino;

  constructor(
    service: string,
    destination?: DestinationStream,
    level = process.env.LOG_LEVEL ?? 'info',
  ) {
    this.pino = pino(
      { level, base: { service }, timestamp: pino.stdTimeFunctions.isoTime },
      destination,
    );
  }

  private emit(
    level: 'info' | 'warn' | 'error' | 'debug' | 'trace',
    message: unknown,
    rest: unknown[],
  ) {
    const last = rest.at(-1);
    const context = typeof last === 'string' ? last : undefined;
    const extra = context === undefined ? rest : rest.slice(0, -1);
    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    const trace = level === 'error' && typeof extra[0] === 'string' ? extra[0] : undefined;
    this.pino[level]({ context, ...(trace ? { trace } : {}) }, msg);
  }

  log(message: unknown, ...rest: unknown[]) {
    this.emit('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.emit('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.emit('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.emit('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.emit('trace', message, rest);
  }
}
