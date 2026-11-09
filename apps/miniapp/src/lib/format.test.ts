import { expect, it } from 'vitest';
import { saleEndDate } from './format';

it('names the end day as the customer reads it in Tashkent', () => {
  // 23:59:59 Tashkent on 12 November is still the 12th (UTC+5), the 12th in UTC too.
  expect(saleEndDate('2026-11-12T18:59:59Z', 'ru')).toBe('12 ноября');
  expect(saleEndDate('2026-12-02T18:59:59Z', 'uz')).toBe('2-dekabrgacha');
  // 00:30 Tashkent on the 3rd is 19:30 UTC on the 2nd: Tashkent's day wins.
  expect(saleEndDate('2026-12-02T19:30:00Z', 'ru')).toBe('3 декабря');
});
