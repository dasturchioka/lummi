import { HOME_QUEUES, type HomeQueue } from '@lummi/contracts';
import { describe, expect, it } from 'vitest';
import { pickNow } from '../src/home/now-picker';

/** The admin Home's Now item (#48): which one thing is lifted out of the queue. */

const none = (): Record<HomeQueue, number> =>
  Object.fromEntries(HOME_QUEUES.map((q) => [q, 0])) as Record<HomeQueue, number>;
const only = (q: HomeQueue, n = 1) => ({ ...none(), [q]: n });

const calm = { cardMissing: false, paused: false };

describe('pickNow', () => {
  it('reads «Всё сделано» only when every queue is empty', () => {
    expect(pickNow({ role: 'owner', ...calm, counts: none() })).toBe('clear');
    expect(pickNow({ role: 'manager', ...calm, counts: none() })).toBe('clear');
    for (const q of HOME_QUEUES)
      expect(pickNow({ role: 'manager', ...calm, counts: only(q, 3) })).not.toBe('clear');
  });

  it('takes the first queue that is not empty, in the fixed order', () => {
    const counts = { ...none(), assemble: 2, refunds: 1, reviews: 4 };
    expect(pickNow({ role: 'manager', ...calm, counts })).toBe('assemble');
    expect(pickNow({ role: 'manager', ...calm, counts: { ...counts, accept: 1 } })).toBe('accept');
    expect(pickNow({ role: 'manager', ...calm, counts: { ...counts, receipts: 1 } })).toBe(
      'receipts',
    );
    expect(pickNow({ role: 'owner', ...calm, counts: only('stock') })).toBe('stock');
    expect(pickNow({ role: 'owner', ...calm, counts: only('reviews') })).toBe('reviews');
  });

  it('walks the whole order: receipts, accept, assemble, BTS, credits, refunds, stock, reviews', () => {
    const counts = Object.fromEntries(HOME_QUEUES.map((q) => [q, 1])) as Record<HomeQueue, number>;
    const seen: string[] = [];
    for (;;) {
      const next = pickNow({ role: 'manager', ...calm, counts });
      if (next === 'clear') break;
      seen.push(next);
      counts[next as HomeQueue] = 0;
    }
    expect(seen).toEqual([
      'receipts',
      'accept',
      'assemble',
      'bts',
      'credits',
      'refunds',
      'stock',
      'reviews',
    ]);
  });

  it('gives the slot to an open Humo pause, for both roles, over any queue', () => {
    const counts = { ...none(), receipts: 2, accept: 5 };
    expect(pickNow({ role: 'owner', cardMissing: false, paused: true, counts })).toBe('humo_pause');
    expect(pickNow({ role: 'manager', cardMissing: false, paused: true, counts })).toBe(
      'humo_pause',
    );
    expect(pickNow({ role: 'manager', cardMissing: false, paused: true, counts: none() })).toBe(
      'humo_pause',
    );
  });

  it('gives the slot to a missing shop card for the owner only, before a pause', () => {
    const counts = only('receipts');
    expect(pickNow({ role: 'owner', cardMissing: true, paused: false, counts })).toBe('no_card');
    expect(pickNow({ role: 'owner', cardMissing: true, paused: true, counts })).toBe('no_card');
    expect(pickNow({ role: 'owner', cardMissing: true, paused: false, counts: none() })).toBe(
      'no_card',
    );
    // a manager cannot set the card: their own work keeps the slot
    expect(pickNow({ role: 'manager', cardMissing: true, paused: false, counts })).toBe('receipts');
    expect(pickNow({ role: 'manager', cardMissing: true, paused: true, counts })).toBe(
      'humo_pause',
    );
    expect(pickNow({ role: 'manager', cardMissing: true, paused: false, counts: none() })).toBe(
      'clear',
    );
  });
});
