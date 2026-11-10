import { describe, expect, it } from 'vitest';
import { normalizeRecipientPhone } from './recipient';

describe('normalizeRecipientPhone', () => {
  const uz = ['998'];
  it.each([
    ['+998901234567', '+998901234567'],
    ['+998 90 123 45 67', '+998901234567'],
    ['998 (93) 555-44-33', '+998935554433'],
    ['90 123 45 67', '+998901234567'],
    ['  901234567 ', '+998901234567'],
  ])('reads %j as %s', (typed, e164) => {
    expect(normalizeRecipientPhone(typed, uz)).toBe(e164);
  });

  it.each([
    '',
    '+7 912 000 00 00',
    '+90 123 45 67',
    '12345',
    '+998 90 123 45 6',
    '90 123 45 67 8',
    'phone 901234567',
  ])('refuses %j while only 998 is allowed', (typed) => {
    expect(normalizeRecipientPhone(typed, uz)).toBeNull();
  });

  it('takes any allowed country, with E.164 lengths where none is fixed', () => {
    const codes = ['998', '7'];
    expect(normalizeRecipientPhone('+7 912 000 00 00', codes)).toBe('+79120000000');
    expect(normalizeRecipientPhone('+7 912', codes)).toBeNull();
    expect(normalizeRecipientPhone('+998 90 123 45 67', codes)).toBe('+998901234567');
    // a local nine-digit number is Uzbek only while 998 is allowed
    expect(normalizeRecipientPhone('90 123 45 67', ['7'])).toBeNull();
  });
});
