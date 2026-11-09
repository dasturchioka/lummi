import { describe, expect, it } from 'vitest';
import { normalizeRecipientPhone } from './recipient';

describe('normalizeRecipientPhone', () => {
  it.each([
    ['+998901234567', '+998901234567'],
    ['+998 90 123 45 67', '+998901234567'],
    ['998 (93) 555-44-33', '+998935554433'],
    ['90 123 45 67', '+998901234567'],
    ['  901234567 ', '+998901234567'],
  ])('reads %j as %s', (typed, e164) => {
    expect(normalizeRecipientPhone(typed)).toBe(e164);
  });

  it.each([
    '',
    '+7 912 000 00 00',
    '+90 123 45 67',
    '12345',
    '+998 90 123 45 6',
    '90 123 45 67 8',
    'phone 901234567',
  ])('refuses %j', (typed) => {
    expect(normalizeRecipientPhone(typed)).toBeNull();
  });
});
