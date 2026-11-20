import { adminMessages } from '@lummi/i18n/admin';
import { describe, expect, it } from 'vitest';
import {
  age,
  change,
  countChange,
  moment,
  nowKey,
  QUEUE_HREF,
  stockHalves,
  threadShare,
  weekdayOf,
} from './home-format';

const ru = adminMessages.ru.admin.home;
const uz = adminMessages.uz.admin.home;
const NB = ' ';

describe('age', () => {
  it('reads seconds, minutes, hours with minutes, and days, rounded down', () => {
    expect(age(27, ru)).toBe(`27${NB}с`);
    expect(age(12 * 60 + 59, ru)).toBe(`12${NB}мин`);
    expect(age(3 * 3600, ru)).toBe(`3${NB}ч`);
    expect(age(3 * 3600 + 5 * 60, ru)).toBe(`3${NB}ч 5${NB}мин`);
    expect(age(2 * 86_400 + 3600, ru)).toBe(`2${NB}дн.`);
    expect(age(34 * 60, uz)).toBe(`34${NB}daqiqa`);
  });
});

describe('moment', () => {
  const today = '2026-11-14';
  it('says today, yesterday or the date, from the server’s day', () => {
    expect(moment({ day: today, time: '10:05' }, today, ru.since, 'ru')).toBe('с 10:05');
    expect(moment({ day: '2026-11-13', time: '18:40' }, today, ru.since, 'ru')).toBe(
      'с вчера, 18:40',
    );
    expect(moment({ day: '2026-11-09', time: '18:40' }, today, ru.at, 'ru')).toBe(
      '9 ноября в 18:40',
    );
    expect(moment({ day: '2026-11-13', time: '18:40' }, today, uz.since, 'uz')).toBe(
      'kecha 18:40 dan beri',
    );
    // the first of the month: yesterday is the last day of the month before
    expect(moment({ day: '2026-10-31', time: '23:59' }, '2026-11-01', ru.at, 'ru')).toBe(
      'вчера в 23:59',
    );
  });
});

describe('change', () => {
  it('is a signed whole percent against the base, none without one', () => {
    expect(change(1_284_000, 1_088_000)).toBe(`+18${NB}%`);
    expect(change(900, 1000)).toBe(`−10${NB}%`);
    expect(change(1000, 1000)).toBe(`0${NB}%`);
    expect(change(500, 0)).toBeNull();
    expect(change(null, 1000)).toBeNull();
    // a net below zero has no meaningful percent either
    expect(change(500, -200)).toBeNull();
  });
  it('counts orders as a signed difference', () => {
    expect(countChange(7, 5)).toBe('+2');
    expect(countChange(3, 5)).toBe('−2');
    expect(countChange(5, 5)).toBe('0');
  });
});

describe('the Thread', () => {
  it('fills with the wait against the alert setting, full once it is reached', () => {
    expect(threadShare(6 * 60, 600)).toBeCloseTo(0.6);
    expect(threadShare(900, 600)).toBe(1);
    expect(threadShare(0, 600)).toBe(0);
  });
});

describe('nowKey', () => {
  it('changes only when the item changes, not when its wait grows', () => {
    const a = nowKey({
      kind: 'receipt',
      number: 1004,
      customer: 'Ali',
      amountDue: 1,
      waitedSeconds: 60,
      alertSeconds: 900,
      alerted: false,
      reviewReason: null,
      credit: null,
    });
    const b = nowKey({
      kind: 'receipt',
      number: 1004,
      customer: 'Ali',
      amountDue: 1,
      waitedSeconds: 90,
      alertSeconds: 900,
      alerted: true,
      reviewReason: null,
      credit: null,
    });
    expect(a).toBe(b);
    expect(nowKey({ kind: 'clear' })).not.toBe(a);
    const credit = (id: number) =>
      nowKey({
        kind: 'credit',
        id,
        amountTiyin: 6_000_000,
        at: { day: '2026-11-14', time: '09:49' },
        waitedSeconds: 60,
        cardLast4: '7364',
        onShopCard: true,
        counterparty: null,
      });
    // two credits of one amount in one minute are two items
    expect(credit(7)).not.toBe(credit(8));
  });
});

describe('the stock count', () => {
  it('shows only the halves above zero', () => {
    expect(stockHalves({ out: 1, low: 0 })).toEqual(['out']);
    expect(stockHalves({ out: 0, low: 2 })).toEqual(['low']);
    expect(stockHalves({ out: 1, low: 2 })).toEqual(['out', 'low']);
  });
});

describe('weekdayOf', () => {
  it('reads the day as a calendar day, whatever the browser’s zone', () => {
    expect(weekdayOf('2026-11-14')).toBe(6); // a Saturday
    expect(weekdayOf('2026-11-15')).toBe(0);
  });
});

describe('queue links', () => {
  it('open each list filtered to exactly the queue’s items', () => {
    expect(QUEUE_HREF).toEqual({
      receipts: '/orders?view=list&payment=manual_review',
      accept: '/orders?view=list&status=payment_confirmed',
      assemble: '/orders?view=list&status=accepted',
      bts: '/orders?view=list&status=assembling',
      credits: '/credits?linked=unlinked',
      refunds: '/orders?view=list&payment=refund_owed',
      stock: '/stock?filter=low&visibility=visible',
      reviews: '/reviews?state=waiting',
    });
  });
});
