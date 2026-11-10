import { describe, expect, it } from 'vitest';
import { judgeBirthDate, maskBirthDate } from './birth-date';

describe('the date of birth as typed (ДД.ММ.ГГГГ)', () => {
  it.each([
    ['1', '1'],
    ['14', '14'],
    ['140', '14.0'],
    ['1403', '14.03'],
    ['14031', '14.03.1'],
    ['14031996', '14.03.1996'],
    ['140319961', '14.03.1996'],
    ['14.03.1996', '14.03.1996'],
    ['14/03/1996', '14.03.1996'],
    ['14 03 1996', '14.03.1996'],
    ['14.', '14.'],
    ['', ''],
  ])('%s → %s', (typed, masked) => {
    expect(maskBirthDate(typed)).toBe(masked);
  });

  it('erasing past a dot leaves the digits only', () => {
    expect(maskBirthDate('14.03')).toBe('14.03');
    expect(maskBirthDate('14.0')).toBe('14.0');
  });
});

describe('judging the date', () => {
  const today = '2026-11-09';
  it.each([
    ['14.03.1996', { ok: true, iso: '1996-03-14' }],
    ['29.02.2000', { ok: true, iso: '2000-02-29' }],
    ['09.11.2026', { ok: true, iso: '2026-11-09' }],
    ['', { ok: true, iso: null }],
    ['14.03.19', { ok: false, reason: 'format' }],
    ['31.04.1996', { ok: false, reason: 'format' }],
    ['29.02.1997', { ok: false, reason: 'format' }],
    ['10.11.2026', { ok: false, reason: 'range' }],
    ['31.12.1899', { ok: false, reason: 'range' }],
  ])('%s', (masked, verdict) => {
    expect(judgeBirthDate(masked, today)).toEqual(verdict);
  });
});
