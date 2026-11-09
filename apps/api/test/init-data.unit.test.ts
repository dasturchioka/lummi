import { describe, expect, it } from 'vitest';
import { verifyInitData } from '../src/auth/init-data';
import { SignedPayloadError } from '../src/auth/signed-payload';
import { signInitData } from './harness/sign-init-data';

const BOT = '123456:TEST-bot-token';
const NOW = new Date('2026-11-09T10:00:00Z');
const nowSec = NOW.getTime() / 1000;
const opts = { botToken: BOT, now: NOW, maxAgeSeconds: 300, maxFutureSkewSeconds: 30 };
const user = { id: 42, first_name: 'Ali', username: 'ali', language_code: 'uz' };

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof SignedPayloadError) return e.reason;
    throw e;
  }
  return 'accepted';
}

describe('verifyInitData', () => {
  it('accepts valid initData and returns the user', () => {
    const raw = signInitData({ botToken: BOT, user, authDate: nowSec - 10 });
    expect(verifyInitData(raw, opts).user).toEqual(user);
  });

  it('accepts initData that carries a signature field (it is left out of the check)', () => {
    const raw = signInitData({
      botToken: BOT,
      user,
      authDate: nowSec,
      unsignedSuffix: [['signature', 'abc-def_ghi']],
    });
    expect(reason(() => verifyInitData(raw, opts))).toBe('accepted');
  });

  it('refuses forged data: tampered user id, wrong bot token, wrong hash', () => {
    const good = signInitData({ botToken: BOT, user, authDate: nowSec });
    const params = new URLSearchParams(good);
    params.set('user', JSON.stringify({ ...user, id: 43 }));
    expect(reason(() => verifyInitData(params.toString(), opts))).toBe('bad_signature');

    const other = signInitData({ botToken: '999:OTHER', user, authDate: nowSec });
    expect(reason(() => verifyInitData(other, opts))).toBe('bad_signature');

    const params2 = new URLSearchParams(good);
    params2.set('hash', '0'.repeat(64));
    expect(reason(() => verifyInitData(params2.toString(), opts))).toBe('bad_signature');
  });

  it('refuses malformed input without crashing', () => {
    expect(reason(() => verifyInitData('', opts))).toBe('malformed');
    expect(reason(() => verifyInitData('hash=zz&auth_date=1', opts))).toBe('malformed');
    expect(reason(() => verifyInitData('garbage', opts))).toBe('malformed');
  });

  it('refuses stale auth_date', () => {
    const raw = signInitData({ botToken: BOT, user, authDate: nowSec - 301 });
    expect(reason(() => verifyInitData(raw, opts))).toBe('stale');
    const edge = signInitData({ botToken: BOT, user, authDate: nowSec - 300 });
    expect(reason(() => verifyInitData(edge, opts))).toBe('accepted');
  });

  it('refuses future-dated auth_date beyond the skew bound, accepts within it', () => {
    const far = signInitData({ botToken: BOT, user, authDate: nowSec + 31 });
    expect(reason(() => verifyInitData(far, opts))).toBe('future');
    const near = signInitData({ botToken: BOT, user, authDate: nowSec + 30 });
    expect(reason(() => verifyInitData(near, opts))).toBe('accepted');
  });

  it('refuses duplicate fields, even when the signed copy is valid', () => {
    const dupUser = signInitData({
      botToken: BOT,
      user,
      authDate: nowSec,
      unsignedSuffix: [['user', JSON.stringify({ id: 1, first_name: 'Admin' })]],
    });
    expect(reason(() => verifyInitData(dupUser, opts))).toBe('duplicate_field');
    const dupAuth = signInitData({
      botToken: BOT,
      user,
      authDate: nowSec,
      unsignedSuffix: [['auth_date', '1']],
    });
    expect(reason(() => verifyInitData(dupAuth, opts))).toBe('duplicate_field');
    const good = signInitData({ botToken: BOT, user, authDate: nowSec });
    const hash = new URLSearchParams(good).get('hash')!;
    expect(reason(() => verifyInitData(`${good}&hash=${hash}`, opts))).toBe('duplicate_field');
  });
});
