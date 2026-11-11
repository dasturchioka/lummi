import type { Logger } from '../../src/logger';

export interface LogLine {
  level: 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
  msg: string;
}

/** A logger that keeps every line, for assertions (and for "never logs the text"). */
export function recordingLogger(): Logger & { lines: LogLine[]; text(): string } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine['level']) =>
    (fields: Record<string, unknown>, msg: string): void => {
      lines.push({ level, fields, msg });
    };
  return {
    lines,
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    text: () => lines.map((l) => `${l.level} ${l.msg} ${JSON.stringify(l.fields)}`).join('\n'),
  };
}
