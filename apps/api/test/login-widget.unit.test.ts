import { describe, expect, it } from 'vitest';
import { LoginWidgetError, verifyLoginWidget } from '../src/admin/login-widget';
import { signLoginWidget } from './harness/sign-login-widget';

const botToken = '123456:TEST-bot-token';
const now = new Date('2026-11-09T10:00:00Z');
const nowSec = Math.floor(now.getTime() / 1000);
const opts = { botToken, now, maxAgeSeconds: 300, maxFutureSkewSeconds: 30 };
const user = { id: 42, first_name: 'Ali', username: 'ali' };

function reason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof LoginWidgetError ? e.reason : 'other';
  }
}

describe('verifyLoginWidget', () => {
  it('accepts a correctly signed, fresh payload', () => {
    const payload = signLoginWidget({ botToken, user, authDate: nowSec - 10 });
    expect(verifyLoginWidget(payload, opts)).toMatchObject({ id: 42, first_name: 'Ali' });
  });

  it('rejects a payload signed with another token or tampered after signing', () => {
    const other = signLoginWidget({ botToken: 'other:token', user, authDate: nowSec });
    expect(reason(() => verifyLoginWidget(other, opts))).toBe('bad_signature');
    const tampered = { ...signLoginWidget({ botToken, user, authDate: nowSec }), id: 43 };
    expect(reason(() => verifyLoginWidget(tampered, opts))).toBe('bad_signature');
  });

  it('rejects stale and future-dated payloads', () => {
    const stale = signLoginWidget({ botToken, user, authDate: nowSec - 301 });
    const future = signLoginWidget({ botToken, user, authDate: nowSec + 31 });
    expect(reason(() => verifyLoginWidget(stale, opts))).toBe('stale');
    expect(reason(() => verifyLoginWidget(future, opts))).toBe('future');
  });

  it('rejects a missing or malformed hash', () => {
    const { hash: _hash, ...noHash } = signLoginWidget({ botToken, user, authDate: nowSec });
    expect(reason(() => verifyLoginWidget(noHash, opts))).toBe('malformed');
    expect(reason(() => verifyLoginWidget({ ...noHash, hash: 'zz' }, opts))).toBe('malformed');
  });
});
