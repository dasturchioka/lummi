import { describe, expect, it } from 'vitest';
import { errorClassOf, normaliseRoute, signError } from '../src/ops/fingerprint';

class OrderBroke extends Error {}

function thrower(message: string): Error {
  return new OrderBroke(message);
}

describe('normaliseRoute', () => {
  it('drops the query string and replaces ids, hashes and tokens', () => {
    expect(normaliseRoute('get', '/orders/123/receipt?phone=%2B998901234567')).toBe(
      'GET /orders/:id/receipt',
    );
    expect(normaliseRoute('GET', '/media/private/0123456789abcdef0123')).toBe(
      'GET /media/private/:id',
    );
    expect(normaliseRoute('POST', '/telegram/webhook')).toBe('POST /telegram/webhook');
  });
});

describe('signError', () => {
  it('gives one fingerprint to the same error with a different message', () => {
    const a = signError(thrower('user 998901234567 not found'), 'GET /x');
    const b = signError(thrower('user 998909999999 not found'), 'GET /x');
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.errorClass).toBe('OrderBroke');
  });

  it('separates the same class on another route', () => {
    expect(signError(thrower('a'), 'GET /x').fingerprint).not.toBe(
      signError(thrower('a'), 'GET /y').fingerprint,
    );
  });

  it('keeps the message and its personal data out of every stored field', () => {
    const sig = signError(thrower('Ali +998901234567 Tashkent, Amir Temur 1'), 'GET /orders/:id');
    expect(JSON.stringify(sig)).not.toMatch(/998901234567|Amir Temur|Ali/);
    expect(sig.frames).toContain('ops-fingerprint.unit.test.ts');
    expect(sig.frames).not.toMatch(/:\d+/); // no line numbers
  });

  it('takes no frame, no personal data and no new fingerprint from a message that looks like a stack', () => {
    const plain = signError(thrower('boom'), 'GET /x');
    const forged = signError(
      thrower(
        'Ali 998901234567\n    at stealPhone (/srv/Amir-Temur-1.ts:1:1)\n    at x (/y.ts:2:2)',
      ),
      'GET /x',
    );
    expect(forged.frames).toBe(plain.frames);
    expect(forged.fingerprint).toBe(plain.fingerprint);
    expect(JSON.stringify(forged)).not.toMatch(/stealPhone|Amir|998901234567/);
  });

  it('ignores a frame-like message set after the throw', () => {
    const e = thrower('first');
    e.message = 'changed\n    at evil (/z.ts:1:1)';
    expect(signError(e, 'GET /x').frames).not.toContain('evil');
  });

  it('files a non-error thrown value without crashing', () => {
    expect(errorClassOf('boom')).toBe('NonError');
    expect(signError(undefined, 'worker:tick').frames).toBe('');
  });
});
