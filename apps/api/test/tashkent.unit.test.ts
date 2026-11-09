import { describe, expect, it } from 'vitest';
import { tashkentToUtc, utcToTashkent } from '@lummi/contracts';

describe('Asia/Tashkent wall clock ↔ UTC (UTC+5 all year)', () => {
  it.each([
    [
      'evening',
      { year: 2025, month: 6, day: 22, hour: 20, minute: 54 },
      '2025-06-22T15:54:00.000Z',
    ],
    [
      'early morning is the previous UTC day',
      { year: 2026, month: 1, day: 1, hour: 3, minute: 10 },
      '2025-12-31T22:10:00.000Z',
    ],
    [
      'leap day',
      { year: 2024, month: 2, day: 29, hour: 12, minute: 0 },
      '2024-02-29T07:00:00.000Z',
    ],
    [
      'end of day with seconds (expiry rule)',
      { year: 2026, month: 11, day: 20, hour: 23, minute: 59, second: 59 },
      '2026-11-20T18:59:59.000Z',
    ],
    [
      '10:00 (birthday coupon time)',
      { year: 2026, month: 11, day: 9, hour: 10, minute: 0 },
      '2026-11-09T05:00:00.000Z',
    ],
  ])('%s', (_name, local, iso) => {
    expect(tashkentToUtc(local)?.toISOString()).toBe(iso);
  });

  it.each([
    ['31 February', { year: 2025, month: 2, day: 31, hour: 0, minute: 0 }],
    ['29 February in a common year', { year: 2025, month: 2, day: 29, hour: 0, minute: 0 }],
    ['month 13', { year: 2025, month: 13, day: 1, hour: 0, minute: 0 }],
    ['hour 24', { year: 2025, month: 6, day: 1, hour: 24, minute: 0 }],
    ['minute 60', { year: 2025, month: 6, day: 1, hour: 0, minute: 60 }],
    ['second 60', { year: 2025, month: 6, day: 1, hour: 0, minute: 0, second: 60 }],
    ['fractional', { year: 2025, month: 6, day: 1, hour: 1.5, minute: 0 }],
  ])('%s is not a date-time', (_name, local) => {
    expect(tashkentToUtc(local)).toBeNull();
  });

  it('reads a UTC instant back as Tashkent wall-clock fields', () => {
    expect(utcToTashkent(new Date('2025-12-31T22:10:30Z'))).toEqual({
      year: 2026,
      month: 1,
      day: 1,
      hour: 3,
      minute: 10,
      second: 30,
    });
  });
});
