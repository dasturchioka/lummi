import { describe, expect, it } from 'vitest';
import { isCreditNotification } from '../src/humo-text';
import { creditText, debitText } from '../src/samples';

/** The emoji variation selector some clients put before an emoji. */
const VS16 = '\uFE0F';

/** Which messages are forwarded to «Поступления»: a ➕ notification, nothing else (ADR 0014). */
describe('isCreditNotification', () => {
  it('is true for a ➕ notification, also one the API will flag (the staff should see it)', () => {
    expect(isCreditNotification(creditText({ amount: 99_000 }))).toBe(true);
    expect(isCreditNotification('➕ 75,750.00 UZS')).toBe(true);
    expect(isCreditNotification(`  ${VS16}➕ 1 UZS`)).toBe(true);
    expect(isCreditNotification("💸 To'lov\r\n➕ 75.750,00 UZS\r\n💳 HUMOCARD *1234")).toBe(true);
  });

  it('is false for a ➖ debit, for text without an operation line, and for two operation lines', () => {
    expect(isCreditNotification(debitText({ amount: 75_750 }))).toBe(false);
    expect(isCreditNotification('')).toBe(false);
    expect(isCreditNotification('Ваш код: 123456')).toBe(false);
    expect(isCreditNotification('Пополнение ➕ 1 000 UZS')).toBe(false);
    expect(isCreditNotification('➕ 1.000,00 UZS\n➖ 1.000,00 UZS')).toBe(false);
    expect(isCreditNotification('➕ 1.000,00 UZS\n➕ 2.000,00 UZS')).toBe(false);
  });
});
