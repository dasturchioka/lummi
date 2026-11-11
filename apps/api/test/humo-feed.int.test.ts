import { internalContract } from '@lummi/contracts';
import { credits, eq, humoMessages, outbox, sql } from '@lummi/db';
import { initClient } from '@ts-rest/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditEvents, type CreditRecorded } from '../src/humo/credit-events';
import { SettingsService } from '../src/settings/settings.service';
import type { WorkerRuntime } from '../src/worker/runtime';
import { userbotLastSeenAt } from './harness/humo';
import { captureLogs } from './harness/logs';
import { createTestApp, TEST_INTERNAL_SECRET, type TestApp } from './harness/test-app';

/** Seam 1 (ADR 0028): the userbot's side of the Humo feed (ADR 0014, ADR 0031) over HTTP. */

let t: TestApp;
let worker: WorkerRuntime;
const OWNER = 4242;

beforeAll(async () => {
  t = await createTestApp();
  worker = t.startWorker();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  t.edges.telegram.sent.length = 0;
  await t.app.get(SettingsService).set('bot.alertRecipients', [OWNER], { type: 'system' });
});

function feed(baseUrl = t.baseUrl, secret: string | null = TEST_INTERNAL_SECRET) {
  return initClient(internalContract, {
    baseUrl,
    baseHeaders: secret === null ? {} : { 'x-internal-secret': secret },
    throwOnUnknownStatus: true,
  });
}

/** The documented layout (spec Changes 2026-11-07) with ➕ and the given amount. */
function creditText(amount = '75.750,00', time = '20:54 22.06.2025'): string {
  return [
    "💸 To'lov",
    `➕ ${amount} UZS`,
    '📍 CLICK P2P HUMO2UZCAR',
    '💳 HUMOCARD *1234',
    `🕓 ${time}`,
    '💰 1.234.567,89 UZS',
  ].join('\n');
}
const DEBIT_TEXT = creditText().replace('➕', '➖');

const post = (messageId: number, text: string) => feed().humoMessage({ body: { messageId, text } });

describe('internal endpoints refuse anything not internal and authenticated', () => {
  it('refuses a missing or wrong secret, and stores nothing', async () => {
    for (const secret of [
      null,
      'wrong',
      TEST_INTERNAL_SECRET.slice(0, -1),
      `${TEST_INTERNAL_SECRET}x`,
    ]) {
      const client = feed(t.baseUrl, secret);
      expect(
        (await client.humoMessage({ body: { messageId: 1, text: creditText() } })).status,
      ).toBe(401);
      expect((await client.humoLastMessageId()).status).toBe(401);
      expect((await client.userbotHeartbeat({ body: {} })).status).toBe(401);
    }
    expect(await t.db.select().from(humoMessages)).toHaveLength(0);
    expect(await userbotLastSeenAt(t.db)).toBeNull();
  });

  it('refuses a request relayed by the public reverse proxy, even with the secret', async () => {
    for (const header of ['x-forwarded-for', 'forwarded', 'x-real-ip']) {
      const res = await feed().humoMessage({
        body: { messageId: 1, text: creditText() },
        extraHeaders: { [header]: '203.0.113.7' },
      });
      expect(res.status).toBe(403);
    }
    expect(await t.db.select().from(humoMessages)).toHaveLength(0);
  });

  it('refuses a source address outside INTERNAL_ALLOWED_CIDRS, even with the secret', async () => {
    const other = await createTestApp({ INTERNAL_ALLOWED_CIDRS: '10.0.0.0/8' });
    try {
      const res = await feed(other.baseUrl).humoMessage({
        body: { messageId: 1, text: creditText() },
      });
      expect(res.status).toBe(403);
      expect((await feed(other.baseUrl).userbotHeartbeat({ body: {} })).status).toBe(403);
    } finally {
      await other.close();
    }
  });

  it('does not exist while no secret is configured', async () => {
    const other = await createTestApp({ INTERNAL_API_SECRET: undefined });
    try {
      const res = await fetch(`${other.baseUrl}/internal/humo/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': '' },
        body: JSON.stringify({ messageId: 1, text: creditText() }),
      });
      expect(res.status).toBe(404);
    } finally {
      await other.close();
    }
  });
});

describe('Humo message intake', () => {
  it('records a ➕ credit: exact amount, Tashkent time as UTC, card mask, raw text kept', async () => {
    t.edges.clock.set(new Date('2025-06-22T15:54:30Z'));
    const res = await post(501, creditText());
    expect(res).toMatchObject({
      status: 200,
      body: { outcome: 'credit', duplicate: false, creditId: 1 },
    });
    const [credit] = await t.db.select().from(credits);
    expect(credit).toMatchObject({
      id: 1,
      humoMessageId: 501,
      amountTiyin: 7_575_000,
      amountSom: 75_750,
      occurredAt: new Date('2025-06-22T15:54:00Z'),
      cardMask: 'HUMOCARD *1234',
      cardLast4: '1234',
      counterparty: 'CLICK P2P HUMO2UZCAR',
    });
    const [message] = await t.db.select().from(humoMessages);
    expect(message).toEqual({
      messageId: 501,
      text: creditText(),
      receivedAt: new Date('2025-06-22T15:54:30Z'),
      parseError: null,
    });
  });

  it("keeps tiyin: a credit of 75 750,50 has no whole-so'm amount to match an order", async () => {
    await post(502, creditText('75.750,50'));
    const [credit] = await t.db.select().from(credits);
    expect(credit).toMatchObject({ amountTiyin: 7_575_050, amountSom: null });
  });

  it('is idempotent on message_id: a repeat answers the same credit and records nothing', async () => {
    await post(503, creditText());
    const again = await post(503, creditText('99.000,00'));
    expect(again).toMatchObject({
      status: 200,
      body: { outcome: 'credit', duplicate: true, creditId: 1 },
    });
    expect(await t.db.select().from(credits)).toHaveLength(1);
    expect((await t.db.select().from(credits))[0]!.amountTiyin).toBe(7_575_000);
  });

  it('concurrent repeats of one message_id record one credit', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post(504, creditText())));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const fresh = results.filter((r) => r.status === 200 && !r.body.duplicate);
    expect(fresh).toHaveLength(1);
    expect(await t.db.select().from(credits)).toHaveLength(1);
  });

  it('ignores a ➖ debit and stores nothing of it', async () => {
    const res = await post(505, DEBIT_TEXT);
    expect(res).toMatchObject({
      status: 200,
      body: { outcome: 'debit', duplicate: false, creditId: null },
    });
    expect(await t.db.select().from(humoMessages)).toHaveLength(0);
    expect(await t.db.select().from(credits)).toHaveLength(0);
  });

  it('stores an unparseable message raw, flags it, and alerts the owner once without its text', async () => {
    const text = 'Kartangiz vaqtincha bloklandi. Kod: 123456';
    const res = await post(506, text);
    expect(res).toMatchObject({
      status: 200,
      body: { outcome: 'unparseable', duplicate: false, creditId: null },
    });
    expect(await t.db.select().from(humoMessages)).toEqual([
      expect.objectContaining({ messageId: 506, text, parseError: 'not_an_operation' }),
    ]);
    expect(await t.db.select().from(credits)).toHaveLength(0);

    await vi.waitFor(() => expect(t.edges.telegram.sent).toHaveLength(1), { timeout: 10_000 });
    const alert = t.edges.telegram.sent[0]!;
    expect(alert.chatId).toBe(OWNER);
    expect(alert.text).toContain('Humo');
    expect(alert.text).toContain('506');
    expect(alert.text).not.toContain('123456'); // the raw text may hold anything; it stays in the DB

    const again = await post(506, text);
    expect(again).toMatchObject({ body: { outcome: 'unparseable', duplicate: true } });
    expect(await t.db.select().from(outbox)).toHaveLength(1);
  });

  it('flags the field that is missing', async () => {
    await post(507, creditText().replace('💳 HUMOCARD *1234\n', ''));
    await post(508, creditText().replace('🕓 20:54 22.06.2025\n', ''));
    const rows = await t.db.select().from(humoMessages);
    expect(rows.map((r) => [r.messageId, r.parseError])).toEqual([
      [507, 'card'],
      [508, 'time'],
    ]);
  });
});

describe('the "credit recorded" event: durable, handled in the worker (ADR 0021)', () => {
  let unsubscribe: Array<() => void> = [];
  afterEach(() => {
    unsubscribe.forEach((u) => u());
    unsubscribe = [];
  });
  const handledAt = async () => (await t.db.select().from(credits))[0]?.eventHandledAt ?? null;

  it('reaches the handlers once per new credit, after commit, with the credit', async () => {
    const seen: { event: CreditRecorded; committed: boolean }[] = [];
    unsubscribe.push(
      t.app.get(CreditEvents).onCreditRecorded(async (event) => {
        const rows = await t.db.select().from(credits).where(eq(credits.id, event.creditId));
        seen.push({ event, committed: rows.length === 1 });
      }),
    );
    await post(601, creditText('250.000,00'));
    await post(601, creditText('250.000,00'));
    await post(602, DEBIT_TEXT);
    await post(603, 'not an operation');
    await vi.waitFor(async () => expect(await handledAt()).not.toBeNull(), { timeout: 10_000 });
    expect(seen).toEqual([
      {
        event: {
          creditId: 1,
          amountSom: 250_000,
          occurredAt: new Date('2025-06-22T15:54:00Z'),
          cardLast4: '1234',
        },
        committed: true,
      },
    ]);
  });

  it('a credit committed but never dispatched is picked up by the sweep, exactly once', async () => {
    const seen: number[] = [];
    unsubscribe.push(
      t.app.get(CreditEvents).onCreditRecorded((e) => {
        seen.push(e.creditId);
      }),
    );
    // As after a crash between the commit and the dispatch: the rows exist, nothing was queued.
    await t.db
      .insert(humoMessages)
      .values({ messageId: 901, text: creditText(), receivedAt: t.edges.clock.now() });
    await t.db.insert(credits).values({
      humoMessageId: 901,
      amountTiyin: 7_575_000,
      occurredAt: new Date('2025-06-22T15:54:00Z'),
      cardMask: 'HUMOCARD *1234',
      cardLast4: '1234',
    });
    await worker.tick();
    await vi.waitFor(async () => expect(await handledAt()).not.toBeNull(), { timeout: 10_000 });
    await worker.tick();
    t.edges.clock.advance(3600_000); // past any requeue window
    await worker.tick();
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual([1]);
  });

  it('a failing handler does not fail the intake; the queue retries until it succeeds', async () => {
    let calls = 0;
    unsubscribe.push(
      t.app.get(CreditEvents).onCreditRecorded(() => {
        calls += 1;
        if (calls === 1) throw new Error('matching is down');
      }),
    );
    const res = await post(604, creditText());
    expect(res).toMatchObject({ status: 200, body: { outcome: 'credit', creditId: 1 } });
    await vi.waitFor(async () => expect(await handledAt()).not.toBeNull(), { timeout: 15_000 });
    expect(calls).toBe(2);
  });
});

describe('catch-up and heartbeat', () => {
  it('the last message_id is null at first, then the highest stored one (flagged too, debits never)', async () => {
    expect(await feed().humoLastMessageId()).toMatchObject({
      status: 200,
      body: { messageId: null },
    });
    await post(700, creditText());
    await post(650, 'not a notification');
    await post(710, DEBIT_TEXT);
    expect(await feed().humoLastMessageId()).toMatchObject({
      status: 200,
      body: { messageId: 700 },
    });
  });

  it("records the userbot's last-seen time from the clock on each heartbeat", async () => {
    expect(await userbotLastSeenAt(t.db)).toBeNull();
    t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
    expect((await feed().userbotHeartbeat({ body: {} })).status).toBe(200);
    expect(await userbotLastSeenAt(t.db)).toEqual(new Date('2026-11-09T10:00:00Z'));
    t.edges.clock.advance(60_000);
    await feed().userbotHeartbeat({ body: {} });
    expect(await userbotLastSeenAt(t.db)).toEqual(new Date('2026-11-09T10:01:00Z'));
  });
});

describe('where the userbot forwards ➕ notifications (#19)', () => {
  it('is the orders group and its «Поступления» topic, read from the settings each time', async () => {
    expect(await feed().userbotForwardTarget()).toMatchObject({
      status: 200,
      body: { chatId: null, topicId: null },
    });

    const settings = t.app.get(SettingsService);
    await settings.set('bot.groupChatId', -1001234567890, { type: 'system' });
    expect((await feed().userbotForwardTarget()).body).toEqual({
      chatId: -1001234567890,
      topicId: null,
    });

    await settings.set(
      'bot.topics',
      { orders: 2, payments: 3, reviews: 4, system: 5 },
      { type: 'system' },
    );
    expect((await feed().userbotForwardTarget()).body).toEqual({
      chatId: -1001234567890,
      topicId: 3,
    });
  });

  it('answers only the internal caller with the secret', async () => {
    expect((await feed(t.baseUrl, 'wrong').userbotForwardTarget()).status).toBe(401);
    const relayed = await feed().userbotForwardTarget({
      extraHeaders: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(relayed.status).toBe(403);
  });
});

/** Raw POST, for answers the contract does not declare (400, 500). */
const postRaw = (body: unknown) =>
  fetch(`${t.baseUrl}/internal/humo/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': TEST_INTERNAL_SECRET },
    body: JSON.stringify(body),
  });

describe('personal data stays out of logs', () => {
  it('a failing insert answers 500 and logs the cause, never the Humo text', async () => {
    const logs = captureLogs();
    await t.db.execute(sql`ALTER TABLE humo_messages RENAME TO humo_messages_x`);
    try {
      const res = await postRaw({ messageId: 801, text: creditText('12.345,67') });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
    } finally {
      await t.db.execute(sql`ALTER TABLE humo_messages_x RENAME TO humo_messages`);
      logs.stop();
    }
    const logged = logs.entries.map((e) => e.text).join('\n');
    expect(logged).toContain('relation "humo_messages" does not exist');
    for (const secret of ['12.345,67', 'HUMOCARD', '1.234.567,89', 'CLICK P2P']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('refuses a NUL character in the text (Postgres text cannot hold it)', async () => {
    const res = await postRaw({ messageId: 802, text: `${creditText()}\u0000` });
    expect(res.status).toBe(400);
    expect(await t.db.select().from(humoMessages)).toHaveLength(0);
  });
});
