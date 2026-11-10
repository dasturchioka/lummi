import { expect, it } from 'vitest';
import { PinoLogger } from '../src/logging/pino-logger';

function capture() {
  const lines: string[] = [];
  return { lines, stream: { write: (l: string) => void lines.push(l) } };
}

it('writes one JSON line with service, level, context and message', () => {
  const { lines, stream } = capture();
  const log = new PinoLogger('api', stream, 'info');
  log.log('webhook set', 'Bot');
  log.warn('MINIAPP_URL is not set', 'Bot');
  expect(lines).toHaveLength(2);
  const first = JSON.parse(lines[0]!);
  expect(first).toMatchObject({ service: 'api', level: 30, context: 'Bot', msg: 'webhook set' });
  expect(first.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(JSON.parse(lines[1]!)).toMatchObject({ level: 40, context: 'Bot' });
});

it('keeps a message without a context and respects the level', () => {
  const { lines, stream } = capture();
  const log = new PinoLogger('worker', stream, 'warn');
  log.log('quiet');
  log.error('boom');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({ service: 'worker', level: 50, msg: 'boom' });
});

it('logs an Error with its message, not as {}', () => {
  const { lines, stream } = capture();
  const log = new PinoLogger('api', stream, 'info');
  log.error(new Error('connect ECONNREFUSED 127.0.0.1:5432'), 'Main');
  log.error('boot failed', new TypeError('bad config'), 'Main');
  expect(JSON.parse(lines[0]!).msg).toBe('Error: connect ECONNREFUSED 127.0.0.1:5432');
  expect(JSON.parse(lines[1]!).msg).toBe('boot failed TypeError: bad config');
});
