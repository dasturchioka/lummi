import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env';

const valid = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
  BOT_TOKEN: '1:abc',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults and coerces the port', () => {
    expect(parseEnv({ ...valid, API_PORT: '4102' })).toMatchObject({
      API_PORT: 4102,
      API_HOST: '127.0.0.1',
    });
    expect(parseEnv(valid).API_PORT).toBe(4000);
  });
  it('refuses a bad config with a readable message', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...valid, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ ...valid, API_PORT: 'abc' })).toThrow(/API_PORT/);
  });
});
