import { describe, expect, it } from 'vitest';
import { daysLeft, lastDayOf } from '@lummi/contracts';
import {
  birthDaysOpenOn,
  celebratedOn,
  couponWindow,
  nextWindow,
  openWindow,
  type BirthdayRules,
} from '../src/birthday/birthday-dates';

/**
 * The birthday coupon's calendar (TZ §3.8, ticket #30), on the Asia/Tashkent wall clock (UTC+5):
 * issued at 10:00 three days before the birthday, valid through the seventh day after it, 29
 * February celebrated on 28 February in a common year. Expected instants are written out by hand.
 */
const RULES: BirthdayRules = {
  daysBefore: 3,
  daysAfter: 7,
  firstCouponAfterDays: 14,
  issueHour: 10,
};
const d = (s: string) => {
  const [year, month, day] = s.split('-').map(Number) as [number, number, number];
  return { year, month, day };
};
const at = (iso: string) => new Date(iso);

describe('the day a birthday is celebrated', () => {
  it.each([
    ['14 March, any year', '1996-03-14', 2027, '2027-03-14'],
    ['29 February in a leap year', '2000-02-29', 2028, '2028-02-29'],
    ['29 February in a common year is 28 February', '2000-02-29', 2027, '2027-02-28'],
    ['29 February in 2100 (not a leap year) is 28 February', '2000-02-29', 2100, '2100-02-28'],
    ['28 February stays 28 February in a leap year', '1990-02-28', 2028, '2028-02-28'],
    ['1 March stays 1 March in a common year', '1990-03-01', 2027, '2027-03-01'],
  ])('%s', (_name, birth, year, expected) => {
    expect(celebratedOn(d(birth), year)).toEqual(d(expected));
  });
});

describe('the coupon window', () => {
  it('opens at 10:00 Tashkent three days before and ends at 00:00 after the seventh day after', () => {
    const w = couponWindow(d('1996-03-14'), 2027, RULES);
    expect(w).toMatchObject({
      birthdayYear: 2027,
      birthday: d('2027-03-14'),
      firstDay: d('2027-03-11'),
      lastDay: d('2027-03-21'),
    });
    expect(w.issuesAt.toISOString()).toBe('2027-03-11T05:00:00.000Z'); // 10:00 in Tashkent
    expect(w.expiresAt.toISOString()).toBe('2027-03-21T19:00:00.000Z'); // 22 March 00:00 in Tashkent
  });

  it('crosses the year: a 2 January birthday opens on 30 December of the year before', () => {
    const w = couponWindow(d('1990-01-02'), 2027, RULES);
    expect(w.firstDay).toEqual(d('2026-12-30'));
    expect(w.lastDay).toEqual(d('2027-01-09'));
    expect(w.issuesAt.toISOString()).toBe('2026-12-30T05:00:00.000Z');
  });

  it('a 29 February birthday in a common year counts from 28 February', () => {
    const w = couponWindow(d('2000-02-29'), 2027, RULES);
    expect(w.birthday).toEqual(d('2027-02-28'));
    expect(w.firstDay).toEqual(d('2027-02-25'));
    expect(w.lastDay).toEqual(d('2027-03-07'));
  });

  it('a 29 February birthday in a leap year counts from 29 February', () => {
    const w = couponWindow(d('2000-02-29'), 2028, RULES);
    expect(w.firstDay).toEqual(d('2028-02-26'));
    expect(w.lastDay).toEqual(d('2028-03-07'));
  });

  it('opens at the issue hour of the settings (TZ: «в 10:00», changed in admin)', () => {
    const w = couponWindow(d('1996-03-14'), 2027, { ...RULES, issueHour: 14 });
    expect(w.issuesAt.toISOString()).toBe('2027-03-11T09:00:00.000Z'); // 14:00 in Tashkent
    expect(w.expiresAt.toISOString()).toBe('2027-03-21T19:00:00.000Z');
    const midnight = couponWindow(d('1996-03-14'), 2027, { ...RULES, issueHour: 0 });
    expect(midnight.issuesAt.toISOString()).toBe('2027-03-10T19:00:00.000Z');
  });

  it('follows the settings', () => {
    const w = couponWindow(d('1996-03-14'), 2027, { ...RULES, daysBefore: 0, daysAfter: 0 });
    expect(w.firstDay).toEqual(d('2027-03-14'));
    expect(w.issuesAt.toISOString()).toBe('2027-03-14T05:00:00.000Z');
    expect(w.expiresAt.toISOString()).toBe('2027-03-14T19:00:00.000Z');
  });
});

describe('the window open at a moment', () => {
  const birth = d('1996-03-14');
  it.each([
    ['09:59:59 Tashkent on the first day: not yet', '2027-03-11T04:59:59Z', null],
    ['10:00 Tashkent on the first day: open', '2027-03-11T05:00:00Z', 2027],
    ['the birthday itself', '2027-03-14T12:00:00Z', 2027],
    ['23:59:59 Tashkent on the last day: still open', '2027-03-21T18:59:59Z', 2027],
    ['00:00 Tashkent the day after: closed', '2027-03-21T19:00:00Z', null],
    ['in the middle of the year: none', '2027-07-01T05:00:00Z', null],
  ])('%s', (_name, now, year) => {
    expect(openWindow(birth, at(now), RULES)?.birthdayYear ?? null).toBe(year);
  });

  it('on 30 December the window of next year’s 2 January birthday is open', () => {
    expect(openWindow(d('1990-01-02'), at('2026-12-30T05:00:00Z'), RULES)?.birthdayYear).toBe(2027);
  });

  it('a 29 February birthday opens on 25 February in a common year and 26 February in a leap one', () => {
    const leapling = d('2000-02-29');
    expect(openWindow(leapling, at('2027-02-25T05:00:00Z'), RULES)?.birthdayYear).toBe(2027);
    expect(openWindow(leapling, at('2028-02-25T05:00:00Z'), RULES)).toBeNull();
    expect(openWindow(leapling, at('2028-02-26T05:00:00Z'), RULES)?.birthdayYear).toBe(2028);
  });
});

describe('the birth dates whose window is open on a Tashkent day', () => {
  const md = (list: { month: number; day: number }[]) =>
    list.map((x) => `${x.month}-${x.day}`).sort();

  it('are the birthdays from daysAfter days ago to daysBefore days ahead', () => {
    // 11 March: birthdays 4 March .. 14 March
    expect(md(birthDaysOpenOn(d('2027-03-11'), RULES))).toEqual(
      md([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((day) => ({ month: 3, day }))),
    );
  });

  it('take in 29 February when the range holds 28 February of a common year', () => {
    const list = md(birthDaysOpenOn(d('2027-02-25'), RULES));
    expect(list).toContain('2-28');
    expect(list).toContain('2-29');
  });

  it('do not take in 29 February twice in a leap year', () => {
    const list = md(birthDaysOpenOn(d('2028-02-26'), RULES));
    expect(list.filter((x) => x === '2-29')).toHaveLength(1);
    expect(list).toContain('2-28');
  });
});

describe('the last day', () => {
  it('is the Tashkent day before `expires_at` (00:00 Tashkent, exclusive)', () => {
    expect(lastDayOf(new Date('2027-03-21T19:00:00Z'))).toEqual(d('2027-03-21'));
    expect(lastDayOf(new Date('2027-01-09T19:00:00Z'))).toEqual(d('2027-01-09'));
  });
});

describe('days left', () => {
  const w = couponWindow(d('1996-03-14'), 2027, RULES); // last day 21 March
  it.each([
    ['10:00 on the first day', '2027-03-11T05:00:00Z', 10],
    ['00:00 Tashkent on 21 March (the last day)', '2027-03-20T19:00:00Z', 0],
    ['23:59 Tashkent on 20 March', '2027-03-20T18:59:00Z', 1],
  ])('%s', (_name, now, left) => {
    expect(daysLeft(w.lastDay, at(now))).toBe(left);
  });
});

describe('the next coupon to come', () => {
  const birth = d('1996-03-14');
  it('is this year’s while its window has not opened', () => {
    const w = nextWindow(birth, at('2026-01-01T00:00:00Z'), at('2027-01-10T00:00:00Z'), RULES, []);
    expect(w?.firstDay).toEqual(d('2027-03-11'));
  });

  it('is next year’s once this year’s was issued', () => {
    const w = nextWindow(
      birth,
      at('2026-01-01T00:00:00Z'),
      at('2027-03-12T00:00:00Z'),
      RULES,
      [2027],
    );
    expect(w?.firstDay).toEqual(d('2028-03-11'));
  });

  it('skips a window that opens sooner than firstCouponAfterDays after the date was entered', () => {
    // entered 1 March 2027: 11 March is only 10 days on, so the first coupon is in 2028
    const w = nextWindow(birth, at('2027-03-01T07:00:00Z'), at('2027-03-01T07:00:00Z'), RULES, []);
    expect(w?.firstDay).toEqual(d('2028-03-11'));
  });

  it('keeps a window that opens exactly firstCouponAfterDays after the date was entered', () => {
    // 10:00 on 25 February + 14 days = 10:00 on 11 March
    const w = nextWindow(birth, at('2027-02-25T05:00:00Z'), at('2027-02-25T05:00:00Z'), RULES, []);
    expect(w?.firstDay).toEqual(d('2027-03-11'));
  });
});
