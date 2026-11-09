import { auditLog, customers, eq, outbox, processedUpdates } from '@lummi/db';
import { dictionaries } from '@lummi/i18n/all';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboxService } from '../src/outbox/outbox.service';
import { AlertService } from '../src/outbox/alert.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { createTestApp, TEST_MINIAPP_URL, type TestApp } from './harness/test-app';
import type { WorkerRuntime } from '../src/worker/runtime';

let t: TestApp;
let worker: WorkerRuntime;
let settings: SettingsService;
let alerts: AlertService;
let outboxSvc: OutboxService;
let updateId = 1000;

beforeAll(async () => {
  t = await createTestApp();
  worker = t.startWorker();
  settings = new SettingsService(t.db, new AuditService(), t.edges);
  alerts = t.app.get(AlertService);
  outboxSvc = t.app.get(OutboxService);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  t.edges.telegram.sent.length = 0;
  t.edges.telegram.blockedChats.clear();
});

function startUpdate(userId: number, languageCode: string | undefined, id = ++updateId) {
  return {
    update_id: id,
    message: {
      message_id: 1,
      date: 1_700_000_000,
      chat: { id: userId, type: 'private', first_name: 'Ali' },
      from: { id: userId, is_bot: false, first_name: 'Ali', language_code: languageCode },
      text: '/start',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  };
}

const delivered = (n: number) =>
  vi.waitFor(() => expect(t.edges.telegram.sent).toHaveLength(n), { timeout: 10_000 });

describe('/start through the webhook', () => {
  it('rejects a wrong secret and does nothing', async () => {
    const res = await t.postUpdate(startUpdate(1, 'ru'), 'nope');
    expect(res.status).toBe(401);
    expect(await t.db.select().from(customers)).toHaveLength(0);
  });

  it('creates the customer and greets in Telegram language with a web_app button', async () => {
    const res = await t.postUpdate(startUpdate(77, 'uz'));
    expect(res.status).toBe(200);
    const [c] = await t.db.select().from(customers);
    expect(c).toMatchObject({ telegramId: 77, language: 'uz', botBlocked: false });
    await delivered(1); // no tick: dispatched right after the commit
    expect(t.edges.telegram.sent[0]).toMatchObject({
      chatId: 77,
      text: dictionaries.uz.bot.greeting,
      options: {
        reply_markup: {
          inline_keyboard: [
            [{ text: dictionaries.uz.bot.openShop, web_app: { url: TEST_MINIAPP_URL } }],
          ],
        },
      },
    });
  });

  it('greets an existing customer in the saved language, not the Telegram one', async () => {
    await t.postUpdate(startUpdate(78, 'uz'));
    await t.postUpdate(startUpdate(78, 'en'));
    await delivered(2);
    expect(t.edges.telegram.sent.every((m) => m.text === dictionaries.uz.bot.greeting)).toBe(true);
  });

  it('deduplicates by update_id', async () => {
    const u = startUpdate(79, 'ru');
    await t.postUpdate(u);
    await t.postUpdate(u);
    expect(await t.db.select().from(processedUpdates)).toHaveLength(1);
    expect(await t.db.select().from(outbox)).toHaveLength(1);
  });

  it('a failing update rolls back its claim so the redelivery is processed', async () => {
    const u = startUpdate(80, 'ru');
    await t.db.execute(`ALTER TABLE outbox RENAME TO outbox_x` as never);
    try {
      expect((await t.postUpdate(u)).status).toBe(500);
    } finally {
      await t.db.execute(`ALTER TABLE outbox_x RENAME TO outbox` as never);
    }
    expect(await t.db.select().from(processedUpdates)).toHaveLength(0);
    expect(await t.db.select().from(customers)).toHaveLength(0);
    expect((await t.postUpdate(u)).status).toBe(200);
    expect(await t.db.select().from(outbox)).toHaveLength(1);
  });
});

describe('bot_blocked', () => {
  it('a 403 marks the customer blocked and /start clears it', async () => {
    t.edges.telegram.blockedChats.add(90);
    await t.postUpdate(startUpdate(90, 'ru')); // the greeting is dispatched at once and gets a 403
    await vi.waitFor(async () => {
      const [c] = await t.db.select().from(customers);
      expect(c!.botBlocked).toBe(true);
    });
    const [row] = await t.db.select().from(outbox);
    expect(row!.failedAt).not.toBeNull();
    expect(t.edges.telegram.sent).toHaveLength(0);

    t.edges.telegram.blockedChats.clear();
    await t.postUpdate(startUpdate(90, 'ru'));
    const [c] = await t.db.select().from(customers);
    expect(c!.botBlocked).toBe(false);
    await delivered(1);
  });

  it('my_chat_member kicked sets bot_blocked and member clears it', async () => {
    await t.postUpdate(startUpdate(91, 'ru'));
    await delivered(1);
    const change = (status: string) => ({
      update_id: ++updateId,
      my_chat_member: {
        chat: { id: 91, type: 'private', first_name: 'Ali' },
        from: { id: 91, is_bot: false, first_name: 'Ali' },
        date: 1_700_000_000,
        old_chat_member: {
          status: 'member',
          user: { id: 123456, is_bot: true, first_name: 'Test' },
        },
        new_chat_member: { status, user: { id: 123456, is_bot: true, first_name: 'Test' } },
      },
    });
    await t.postUpdate(change('kicked'));
    expect((await t.db.select().from(customers))[0]!.botBlocked).toBe(true);
    await t.postUpdate(change('member'));
    expect((await t.db.select().from(customers))[0]!.botBlocked).toBe(false);
  });
});

describe('worker tick', () => {
  it('sends nothing twice when tick runs twice, including sweep-queued messages', async () => {
    let calls = 0;
    worker.register({
      name: 'demo-reminder',
      run: async (ctx) => {
        // The pattern of ADR 0021: stamp the marker and queue in one transaction.
        calls++;
        await ctx.withTx(async (tx) => {
          const stamped = await tx.execute(
            `UPDATE settings SET value = 'true' WHERE key = 'demo.marker' AND value <> 'true' RETURNING key` as never,
          );
          if (stamped.rowCount) await ctx.outbox.enqueue(tx, { chatId: 5, text: 'reminder' });
        });
      },
    });
    await t.db.execute(
      `INSERT INTO settings (key, value) VALUES ('demo.marker', 'false')` as never,
    );
    // inserted without withTx: only the tick can queue it
    await outboxSvc.enqueue(t.db, { chatId: 6, text: 'direct' });

    await worker.tick();
    await worker.tick();
    await delivered(2);
    await new Promise((r) => setTimeout(r, 300));
    await worker.tick();
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(3);
    expect(t.edges.telegram.sent.map((m) => m.text).sort()).toEqual(['direct', 'reminder']);
  });

  it('requeues a row stuck queued past the window, and still sends once', async () => {
    const [id] = await outboxSvc.enqueue(t.db, { chatId: 7, text: 'late' });
    await t.db.update(outbox).set({ queuedAt: t.edges.clock.now() }).where(eq(outbox.id, id!));
    await worker.tick();
    expect(t.edges.telegram.sent).toHaveLength(0); // already marked queued
    t.edges.clock.advance(6 * 60 * 1000);
    await worker.tick();
    await delivered(1);
  });

  it('two concurrent deliveries of one row send once', async () => {
    const [id] = await outboxSvc.enqueue(t.db, { chatId: 8, text: 'once' });
    const results = await Promise.all([outboxSvc.deliver(id!), outboxSvc.deliver(id!)]);
    expect(results.sort()).toEqual(['sent', 'skipped']);
    expect(t.edges.telegram.sent).toHaveLength(1);
  });

  it('a failing sweep alerts the owner once, after N consecutive failures', async () => {
    await settings.set('bot.alertRecipients', [11], { type: 'system' });
    await settings.set('worker.sweepFailureAlertAfter', 2, { type: 'system' });
    worker.register({
      name: 'broken',
      run: () => Promise.reject(new Error('boom')),
    });
    for (let i = 0; i < 4; i++) await worker.tick();
    await delivered(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(t.edges.telegram.sent).toHaveLength(1);
    expect(t.edges.telegram.sent[0]!.text).toContain('broken');
  });
});

describe('orders group', () => {
  it('follows migrate_to_chat_id and updates the setting', async () => {
    await settings.set('bot.groupChatId', -500, { type: 'system' });
    const res = await t.postUpdate({
      update_id: ++updateId,
      message: {
        message_id: 2,
        date: 1_700_000_000,
        chat: { id: -500, type: 'group', title: 'Lummi' },
        from: { id: 1, is_bot: false, first_name: 'Owner' },
        migrate_to_chat_id: -1001234,
      },
    });
    expect(res.status).toBe(200);
    expect(await settings.get('bot.groupChatId')).toBe(-1001234);
    const log = await t.db.select().from(auditLog);
    expect(log.at(-1)).toMatchObject({ actorType: 'system', action: 'setting.changed' });
  });

  it('ignores a migration of some other group', async () => {
    await settings.set('bot.groupChatId', -500, { type: 'system' });
    await t.postUpdate({
      update_id: ++updateId,
      message: {
        message_id: 2,
        date: 1_700_000_000,
        chat: { id: -999, type: 'group', title: 'Other' },
        migrate_to_chat_id: -1009,
      },
    });
    expect(await settings.get('bot.groupChatId')).toBe(-500);
  });
});

describe('alertOwner', () => {
  it('queues to the Системные topic and to each recipient DM', async () => {
    await settings.set('bot.groupChatId', -1001, { type: 'system' });
    await settings.set(
      'bot.topics',
      { orders: 2, payments: 3, reviews: 4, system: 5 },
      { type: 'system' },
    );
    await settings.set('bot.alertRecipients', [11, 22], { type: 'system' });
    await outboxSvc.withTx((tx) => alerts.alertOwner(tx, 'Платёж не найден'));
    await delivered(3);
    const sent = t.edges.telegram.sent;
    expect(sent.find((m) => m.chatId === -1001)).toMatchObject({ threadId: 5 });
    expect(
      sent
        .filter((m) => m.chatId > 0)
        .map((m) => m.chatId)
        .sort(),
    ).toEqual([11, 22]);
    expect(sent.every((m) => m.text.includes('Платёж не найден'))).toBe(true);
  });

  it('with nothing configured it queues nothing', async () => {
    await alerts.alertOwner(t.db, 'x');
    expect(await t.db.select().from(outbox)).toHaveLength(0);
  });
});
