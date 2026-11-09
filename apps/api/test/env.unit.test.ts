import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_SESSION_SECRET, parseEnv } from '../src/env';

const valid = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
  BOT_TOKEN: '1:abc',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('refuses the .env.example placeholder secret in production only', () => {
    const placeholder = { ...valid, SESSION_SECRET: PLACEHOLDER_SESSION_SECRET };
    expect(() =>
      parseEnv({
        ...placeholder,
        TYPESAFE_API_KEY: 'k',
        OPENAI_API_KEY: 'k',
        NODE_ENV: 'production',
      }),
    ).toThrow(/SESSION_SECRET/);
    expect(parseEnv({ ...placeholder, NODE_ENV: 'development' }).SESSION_SECRET).toBe(
      PLACEHOLDER_SESSION_SECRET,
    );
    const keys = { TYPESAFE_API_KEY: 'k' };
    expect(parseEnv({ ...valid, ...keys, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });

  it('requires the TypeSafe key in production and never the OpenAI one', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/TYPESAFE_API_KEY/);
    expect(
      parseEnv({ ...valid, TYPESAFE_API_KEY: 'k', NODE_ENV: 'production' }).OPENAI_API_KEY,
    ).toBeUndefined();
  });

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

  it('defaults the bot to off and requires webhook settings in webhook mode', () => {
    expect(parseEnv(valid).BOT_MODE).toBe('off');
    expect(() => parseEnv({ ...valid, BOT_MODE: 'webhook' })).toThrow(/WEBHOOK_URL/);
    expect(
      parseEnv({
        ...valid,
        BOT_MODE: 'webhook',
        WEBHOOK_URL: 'https://x.example/telegram/webhook',
        WEBHOOK_SECRET: 'abc_123',
      }).BOT_MODE,
    ).toBe('webhook');
  });

  it('internal endpoints: loopback only by default, CIDRs validated, secret at least 32 chars', () => {
    expect(parseEnv(valid).INTERNAL_API_SECRET).toBeUndefined();
    expect(parseEnv(valid)).toMatchObject({
      INTERNAL_ALLOWED_CIDRS: [
        { address: '127.0.0.0', prefix: 8, family: 'ipv4' },
        { address: '::1', prefix: 128, family: 'ipv6' },
      ],
    });
    expect(
      parseEnv({ ...valid, INTERNAL_ALLOWED_CIDRS: ' 127.0.0.1/32 , 172.18.0.0/16 ' })
        .INTERNAL_ALLOWED_CIDRS,
    ).toEqual([
      { address: '127.0.0.1', prefix: 32, family: 'ipv4' },
      { address: '172.18.0.0', prefix: 16, family: 'ipv4' },
    ]);
    for (const bad of ['10.0.0.0', '10.0.0.0/33', '::1/129', 'localhost/8', '10.0.0.0/x']) {
      expect(() => parseEnv({ ...valid, INTERNAL_ALLOWED_CIDRS: bad })).toThrow(
        /INTERNAL_ALLOWED_CIDRS/,
      );
    }
    expect(() => parseEnv({ ...valid, INTERNAL_API_SECRET: 'short' })).toThrow(
      /INTERNAL_API_SECRET/,
    );
  });

  it('refuses the dev-only admin sign-in in production, allows it elsewhere', () => {
    expect(() =>
      parseEnv({
        ...valid,
        TYPESAFE_API_KEY: 'k',
        OPENAI_API_KEY: 'k',
        NODE_ENV: 'production',
        ADMIN_DEV_LOGIN: 'true',
      }),
    ).toThrow(/ADMIN_DEV_LOGIN/);
    expect(
      parseEnv({ ...valid, TYPESAFE_API_KEY: 'k', NODE_ENV: 'production' }).ADMIN_DEV_LOGIN,
    ).toBe(false);
    expect(
      parseEnv({
        ...valid,
        TYPESAFE_API_KEY: 'k',
        OPENAI_API_KEY: 'k',
        NODE_ENV: 'production',
        ADMIN_DEV_LOGIN: 'false',
      }).ADMIN_DEV_LOGIN,
    ).toBe(false);
    expect(
      parseEnv({ ...valid, NODE_ENV: 'development', ADMIN_DEV_LOGIN: 'true' }).ADMIN_DEV_LOGIN,
    ).toBe(true);
    expect(parseEnv({ ...valid, NODE_ENV: 'test', ADMIN_DEV_LOGIN: 'true' }).ADMIN_DEV_LOGIN).toBe(
      true,
    );
    expect(parseEnv(valid).ADMIN_DEV_LOGIN).toBe(false);
  });
});
