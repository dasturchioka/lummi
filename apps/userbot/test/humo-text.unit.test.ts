import { describe, expect, it } from 'vitest';
import { reportsCredit } from '../src/humo-text';
import { creditText, debitText } from '../src/samples';

/** The emoji variation selector some clients put before an emoji. */
const VS16 = '\uFE0F';

/** Which Humo messages are forwarded to «Поступления»: a ➕, nothing else (ADR 0014). */
describe('reportsCredit', () => {
  it('is true for a ➕, also one the API will flag (the staff should see it)', () => {
    expect(reportsCredit(creditText({ amount: 99_000 }))).toBe(true);
    expect(reportsCredit('➕ 75,750.00 UZS')).toBe(true);
    expect(reportsCredit(`  ${VS16}➕ 1 UZS`)).toBe(true);
    expect(reportsCredit("💸 To'lov\r\n➕ 75.750,00 UZS\r\n💳 HUMOCARD *1234")).toBe(true);
  });

  it('is false for a ➖ debit, for text without an operation line, and for two operation lines', () => {
    expect(reportsCredit(debitText({ amount: 75_750 }))).toBe(false);
    expect(reportsCredit('')).toBe(false);
    expect(reportsCredit('Ваш код: 123456')).toBe(false);
    expect(reportsCredit('Пополнение ➕ 1 000 UZS')).toBe(false);
    expect(reportsCredit('➕ 1.000,00 UZS\n➖ 1.000,00 UZS')).toBe(false);
    expect(reportsCredit('➕ 1.000,00 UZS\n➕ 2.000,00 UZS')).toBe(false);
  });
});
