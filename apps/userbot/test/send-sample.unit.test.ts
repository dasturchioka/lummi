import { describe, expect, it } from 'vitest';
import { reportsCredit } from '../src/humo-text';
import { botIdFromToken, parseSampleArgs, sampleText, sendSample } from '../src/send-sample';

/**
 * The dev/staging script (ADR 0023): our test bot sends sample ➕ / ➖ / other messages to the
 * account the userbot runs on. Tested with a fake fetch: it never reaches Telegram here.
 */

const NOW = new Date('2026-11-11T09:41:00Z'); // 14:41 in Tashkent
const TOKEN = '7000000001:AAH-test-token-test-token-test-token-x';

describe('parseSampleArgs and sampleText', () => {
  it('builds a ➕ credit in the documented layout, Tashkent time to the minute', () => {
    const args = parseSampleArgs(['credit', '99000', '--card', '4321'], NOW);
    expect(sampleText(args)).toBe(
      [
        "💸 To'lov",
        '➕ 99.000,00 UZS',
        '📍 HUMO P2P TEST',
        '💳 HUMOCARD *4321',
        '🕓 14:41 11.11.2026',
        '💰 1.234.567,89 UZS',
      ].join('\n'),
    );
    expect(reportsCredit(sampleText(args))).toBe(true);
  });

  it('builds a ➖ debit, an amount with tiyin, and a message that is no operation', () => {
    expect(sampleText(parseSampleArgs(['debit', '75750'], NOW))).toMatch(/^➖ 75\.750,00 UZS$/m);
    expect(sampleText(parseSampleArgs(['credit', '1000', '--tiyin', '50'], NOW))).toMatch(
      /^➕ 1\.000,50 UZS$/m,
    );
    expect(sampleText(parseSampleArgs(['other'], NOW))).not.toMatch(/[➕➖]/);
  });

  it('defaults to a ➕ of 99 000 on card *1234, now', () => {
    expect(parseSampleArgs([], NOW)).toEqual({
      kind: 'credit',
      amount: 99_000,
      tiyin: 0,
      cardLast4: '1234',
      at: NOW,
    });
  });

  it('refuses what it cannot build', () => {
    for (const bad of [
      ['refund'],
      ['credit', '-5'],
      ['credit', '1.5'],
      ['credit', '1', '--card', '12'],
    ]) {
      expect(() => parseSampleArgs(bad, NOW)).toThrow(/usage/);
    }
  });
});

describe('sendSample', () => {
  it('sends the text from the test bot to the account through the Bot API', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchFake = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true, result: { message_id: 17 } });
    };
    await sendSample({ token: TOKEN, chatId: 4242, text: '➕ 1 UZS', fetch: fetchFake });
    expect(calls).toEqual([
      {
        url: `https://api.telegram.org/bot${TOKEN}/sendMessage`,
        body: { chat_id: 4242, text: '➕ 1 UZS' },
      },
    ]);
  });

  it('reports a refusal and a network failure without the token', async () => {
    const refused = async () =>
      Response.json({ ok: false, description: 'Bad Request: chat not found' }, { status: 400 });
    const offline = async () => {
      throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
    };
    for (const f of [refused, offline]) {
      const error = await sendSample({ token: TOKEN, chatId: 1, text: 'x', fetch: f }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(`${String(error)} ${(error as Error).stack}`).not.toContain('AAH-test-token');
    }
  });

  it('the test bot’s user id is the number before the colon of its token', () => {
    expect(botIdFromToken(TOKEN)).toBe(7000000001);
    expect(() => botIdFromToken('nonsense')).toThrow(/token/);
  });
});
