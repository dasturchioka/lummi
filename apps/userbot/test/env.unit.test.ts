import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { envSchema, loginEnvSchema, parseEnv } from '../src/env';

const good = {
  USERBOT_API_ID: '123456',
  USERBOT_API_HASH: '0123456789abcdef0123456789abcdef',
  USERBOT_SESSION_KEY: randomBytes(32).toString('base64'),
  INTERNAL_API_SECRET: 'internal-secret-internal-secret-0123456789',
  USERBOT_LISTEN_CHAT_ID: '7000000001',
};

describe('userbot env (a bad config refuses to boot, ADR 0023)', () => {
  it('reads a good config, with defaults for the rest', () => {
    expect(parseEnv(envSchema, good)).toMatchObject({
      USERBOT_API_ID: 123456,
      USERBOT_LISTEN_CHAT_ID: 7000000001,
      USERBOT_SESSION_FILE: '/data/userbot/session.enc',
      API_URL: 'http://127.0.0.1:4000',
      LOG_LEVEL: 'info',
    });
  });

  it('names every bad key and why, and never echoes a value', () => {
    const bad = {
      ...good,
      USERBOT_API_HASH: 'NOT-A-HASH-but-a-secret-looking-value',
      USERBOT_SESSION_KEY: 'c2hvcnQta2V5LXNlY3JldA==',
      INTERNAL_API_SECRET: 'short-secret-value',
      USERBOT_LISTEN_CHAT_ID: '-5579977857',
    };
    let message = '';
    try {
      parseEnv(envSchema, bad);
    } catch (e) {
      message = (e as Error).message;
    }
    for (const k of [
      'USERBOT_API_HASH',
      'USERBOT_SESSION_KEY',
      'INTERNAL_API_SECRET',
      'USERBOT_LISTEN_CHAT_ID',
    ]) {
      expect(message).toContain(k);
    }
    for (const v of [bad.USERBOT_API_HASH, bad.USERBOT_SESSION_KEY, bad.INTERNAL_API_SECRET]) {
      expect(message).not.toContain(v);
    }
  });

  it('the login needs only the app credentials and the session key', () => {
    const { INTERNAL_API_SECRET: _s, USERBOT_LISTEN_CHAT_ID: _c, ...loginOnly } = good;
    expect(() => parseEnv(loginEnvSchema, loginOnly)).not.toThrow();
    expect(() => parseEnv(envSchema, loginOnly)).toThrow(/INTERNAL_API_SECRET/);
  });
});
