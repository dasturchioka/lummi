import type { BroadcastBody, BroadcastDto } from '@lummi/contracts';
import { dictionaries } from '@lummi/i18n/all';
import {
  auditLog,
  broadcastDeliveries,
  broadcasts,
  customers,
  eq,
  type CustomerRow,
} from '@lummi/db';
import type { Job } from 'bullmq';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotBlockedError, RateLimitedError } from '../src/edges';
import { OutboxService } from '../src/outbox/outbox.service';
import { CustomersService } from '../src/auth/customers.service';
import { moveCustomerData } from '../src/auth/customers.service';
import { BROADCAST_ATTEMPTS, BroadcastService } from '../src/broadcast/broadcast.service';
import { SettingsService } from '../src/settings/settings.service';
import { seedCatalog } from '../src/catalog/seed';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));

let t: TestApp;
let svc: BroadcastService;
let owner: StaffSession;
let manager: StaffSession;

beforeAll(async () => {
  t = await createTestApp();
  t.startWorker();
  svc = t.app.get(BroadcastService);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  t.edges.files.files.clear();
  t.edges.telegram.sent.length = 0;
  t.edges.telegram.blockedChats.clear();
  t.edges.telegram.failures.clear();
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

let nextTelegramId = 5000;
async function customer(over: Partial<typeof customers.$inferInsert> = {}): Promise<CustomerRow> {
  const [row] = await t.db
    .insert(customers)
    .values({
      telegramId: ++nextTelegramId,
      firstName: 'Ali',
      language: 'ru',
      writeAccess: 'granted',
      ...over,
    })
    .returning();
  return row as CustomerRow;
}

const body = (over: Partial<BroadcastBody> = {}): BroadcastBody => ({
  textRu: 'Новый аромат уже в LUMMI.',
  textUz: "LUMMI'da yangi atir bor.",
  imageKey: null,
  buttonTarget: null,
  audience: 'all',
  ...over,
});

/** The typed client's unions include an unvalidated 400; these tests read the documented bodies. */
const create = async (b: BroadcastBody, as: StaffSession = owner) =>
  (await as.client.admin.broadcasts.create({ body: b })) as { status: number; body: BroadcastDto };

async function counts(id: number) {
  const res = await owner.client.admin.broadcasts.get({ params: { id } });
  if (res.status !== 200) throw new Error(`get failed: ${res.status}`);
  return res.body;
}
const finished = (id: number) =>
  vi.waitFor(async () => expect((await counts(id)).status).toBe('done'), { timeout: 10_000 });

/** A broadcast with its deliveries written straight to the DB: never queued, so a test drives the jobs itself. */
async function seed(customerIds: number[], over: Partial<typeof broadcasts.$inferInsert> = {}) {
  const [b] = await t.db
    .insert(broadcasts)
    .values({ audience: 'all', textRu: 'Привет', textUz: 'Salom', createdByName: 'Owner', ...over })
    .returning();
  await t.db
    .insert(broadcastDeliveries)
    .values(customerIds.map((customerId) => ({ broadcastId: b!.id, customerId })));
  return b!;
}
const worker = { rateLimit: vi.fn(async () => {}) };
const job = (broadcastId: number, customerId: number, attemptsMade = 0) =>
  ({ data: { broadcastId, customerId }, attemptsMade }) as Job<{
    broadcastId: number;
    customerId: number;
  }>;

describe('owner only', () => {
  it('answers a manager 403 and a visitor 401 on every route', async () => {
    const calls = await Promise.all([
      manager.client.admin.broadcasts.list(),
      manager.client.admin.broadcasts.audience({ query: { audience: 'all' } }),
      manager.client.admin.broadcasts.get({ params: { id: 1 } }),
      create(body(), manager),
      manager.client.admin.broadcasts.test({ body: body() }),
      t.client.admin.broadcasts.list(),
      t.client.admin.broadcasts.create({ body: body() }),
    ]);
    expect(calls.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 401, 401]);
    const upload = await fetch(`${t.baseUrl}/admin/broadcasts/image`, {
      method: 'PUT',
      headers: { cookie: manager.cookie, 'content-type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(upload.status).toBe(403);
    expect(await t.db.select().from(broadcasts)).toHaveLength(0);
    expect(t.edges.telegram.sent).toHaveLength(0);
  });
});

describe('sending', () => {
  it('sends each customer the text in their language, to the whole audience', async () => {
    const ru = await customer({ language: 'ru' });
    const uz = await customer({ language: 'uz' });
    const res = await create(body());
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    await finished(id);
    const byChat = new Map(t.edges.telegram.sent.map((m) => [m.chatId, m.text]));
    expect(byChat.get(ru.telegramId)).toBe('Новый аромат уже в LUMMI.');
    expect(byChat.get(uz.telegramId)).toBe('LUMMI’da yangi atir bor.'); // apostrophe normalised
    expect((await counts(id)).counts).toEqual({
      total: 2,
      sent: 2,
      blocked: 0,
      failed: 0,
      pending: 0,
    });
  });

  it('filters the audience by language', async () => {
    const ru = await customer({ language: 'ru' });
    await customer({ language: 'uz' });
    const res = await create(body({ audience: 'ru' }));
    await finished(res.body.id as number);
    expect(t.edges.telegram.sent.map((m) => m.chatId)).toEqual([ru.telegramId]);
    expect((await counts(res.body.id as number)).counts.total).toBe(1);

    const uzOnly = await create(body({ audience: 'uz' }));
    await finished(uzOnly.body.id as number);
    expect(t.edges.telegram.sent).toHaveLength(2);
    expect(t.edges.telegram.sent[1]?.text).toContain('yangi atir');
  });

  it('counts the audience live, with the customers the bot may not write to apart', async () => {
    await customer({ language: 'ru' });
    await customer({ language: 'ru', writeAccess: 'refused' });
    await customer({ language: 'uz', botBlocked: true });
    await customer({ language: 'uz', writeAccess: null }); // opened the Mini App, never started the bot
    await customer({ language: 'uz' });
    await customer({ language: 'uz' });
    const all = await owner.client.admin.broadcasts.audience({ query: { audience: 'all' } });
    // the reachable ones split by the language they will get it in
    expect(all.body).toEqual({ total: 6, reachable: 3, reachableByLanguage: { ru: 1, uz: 2 } });
    const ru = await owner.client.admin.broadcasts.audience({ query: { audience: 'ru' } });
    expect(ru.body).toEqual({ total: 2, reachable: 1, reachableByLanguage: { ru: 1, uz: 0 } });
  });

  it("names a fragrance target's fragrance as the owner types the slug, for the owner only", async () => {
    await seedCatalog(t.db, { materialsDir });
    const known = await owner.client.admin.broadcasts.fragrance({ query: { slug: 'tygar' } });
    expect(known).toMatchObject({ status: 200, body: { name: 'Tygar' } });
    const unknown = await owner.client.admin.broadcasts.fragrance({
      query: { slug: 'no-such-fragrance' },
    });
    expect(unknown.status).toBe(404);
    const asManager = await manager.client.admin.broadcasts.fragrance({ query: { slug: 'tygar' } });
    expect(asManager.status).toBe(403);
  });

  it('skips customers who refused write access or blocked the bot, and counts them blocked', async () => {
    await customer();
    await customer({ writeAccess: 'refused' });
    await customer({ botBlocked: true });
    const res = await create(body());
    const id = res.body.id as number;
    // the skipped two are blocked at once, before any job runs
    expect(res.body.counts.blocked).toBe(2);
    await finished(id);
    expect(t.edges.telegram.sent).toHaveLength(1);
    expect((await counts(id)).counts).toMatchObject({ total: 3, sent: 1, blocked: 2, pending: 0 });
  });

  it('marks a customer bot_blocked on a 403 and counts it blocked, not failed', async () => {
    const gone = await customer();
    const fine = await customer();
    t.edges.telegram.blockedChats.add(gone.telegramId);
    const res = await create(body());
    const id = res.body.id as number;
    await finished(id);
    expect((await counts(id)).counts).toMatchObject({ sent: 1, blocked: 1, failed: 0 });
    const [row] = await t.db.select().from(customers).where(eq(customers.id, gone.id));
    expect(row?.botBlocked).toBe(true);
    expect(t.edges.telegram.sent.map((m) => m.chatId)).toEqual([fine.telegramId]);
  });

  it('sends an image as a photo with the text as caption, and the startapp button in the language', async () => {
    const ru = await customer({ language: 'ru' });
    const uz = await customer({ language: 'uz' });
    const png = await sharp({
      create: { width: 600, height: 800, channels: 3, background: '#CFC6B8' },
    })
      .png()
      .toBuffer();
    const up = await fetch(`${t.baseUrl}/admin/broadcasts/image`, {
      method: 'PUT',
      headers: { cookie: owner.cookie, 'content-type': 'image/png' },
      body: new Uint8Array(png),
    });
    expect(up.status).toBe(200);
    const { key } = (await up.json()) as { key: string };
    expect(t.edges.files.files.has(key)).toBe(true);
    const res = await create(body({ imageKey: key, buttonTarget: 'catalog' }));
    expect(res.status).toBe(201);
    await finished(res.body.id as number);
    const to = (id: number) => t.edges.telegram.sent.find((m) => m.chatId === id)!;
    const photo = to(ru.telegramId).photo as { bytes: Uint8Array };
    expect(Buffer.from(photo.bytes).equals(png)).toBe(true);
    expect(to(ru.telegramId).options).toEqual({
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: dictionaries.ru.bot.broadcastOpen,
              url: 'https://t.me/lummi_dev_bot?startapp=catalog',
            },
          ],
        ],
      },
    });
    expect(JSON.stringify(to(uz.telegramId).options)).toContain(dictionaries.uz.bot.broadcastOpen);
  });

  it('refuses a bad composition with 422 or 400 and sends nothing', async () => {
    await customer();
    const long = 'я'.repeat(1025);
    // 1025 characters fit a text message but not a caption
    const noImage = await create(body({ textRu: long }));
    expect(noImage.status).toBe(201);
    const missingImage = await create(body({ imageKey: 'broadcasts/0123456789abcdef.png' }));
    expect(missingImage.status).toBe(422);
    const noFragrance = await create(body({ buttonTarget: 'p_no-such-fragrance' }));
    expect(noFragrance.status).toBe(422);
    const badTarget = await fetch(`${t.baseUrl}/admin/broadcasts`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body({ buttonTarget: 'https://evil.example' })),
    });
    expect(badTarget.status).toBe(400);
    const emptyUz = await fetch(`${t.baseUrl}/admin/broadcasts`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body({ textUz: '  ' })),
    });
    expect(emptyUz.status).toBe(400);
    const notAnImage = await fetch(`${t.baseUrl}/admin/broadcasts/image`, {
      method: 'PUT',
      headers: { cookie: owner.cookie, 'content-type': 'image/png' },
      body: new Uint8Array([0, 1, 2, 3]),
    });
    expect(notAnImage.status).toBe(415);
  });

  it('audits the broadcast, its audience and who sent it', async () => {
    await customer();
    await customer({ language: 'uz' });
    const res = await create(body({ audience: 'all' }));
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'broadcast.sent'));
    expect(entry).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetType: 'broadcast',
      targetId: String(res.body.id),
      payload: { audience: 'all', audienceSize: 2, sender: owner.staff.name },
    });
    await finished(res.body.id as number);
    expect(res.body.createdByName).toBe(owner.staff.name);
  });
});

describe('jobs', () => {
  it('is idempotent: a retried job after a send sends nothing', async () => {
    const c = await customer();
    const b = await seed([c.id]);
    await svc.process(job(b.id, c.id), worker);
    await svc.process(job(b.id, c.id), worker); // the queue redelivers it
    expect(await svc.deliver(b.id, c.id)).toBe('skipped');
    expect(t.edges.telegram.sent).toHaveLength(1);
  });

  it('holds back two concurrent attempts on one delivery', async () => {
    const c = await customer();
    const b = await seed([c.id]);
    await Promise.all([svc.deliver(b.id, c.id), svc.deliver(b.id, c.id)]);
    expect(t.edges.telegram.sent).toHaveLength(1);
  });

  it('pauses the whole queue for a flood wait beyond 60 s and keeps the attempt', async () => {
    const c = await customer();
    const b = await seed([c.id]);
    t.edges.telegram.failures.set(c.telegramId, [new RateLimitedError(120)]);
    worker.rateLimit.mockClear();
    await expect(svc.process(job(b.id, c.id, 2), worker)).rejects.toThrow(
      'bullmq:rateLimitExceeded',
    );
    expect(worker.rateLimit).toHaveBeenCalledWith(120_000);
    expect((await t.db.select().from(broadcastDeliveries))[0]).toMatchObject({
      status: 'pending',
      sendingAt: null,
    });
    // after the wait the same job sends once, and counts no failure even on its last attempt
    await svc.process(job(b.id, c.id, BROADCAST_ATTEMPTS - 1), worker);
    expect(t.edges.telegram.sent).toHaveLength(1);
    expect((await t.db.select().from(broadcastDeliveries))[0]?.status).toBe('sent');
  });

  it('counts any other error as failed once the attempts run out, and never as blocked', async () => {
    const c = await customer();
    const b = await seed([c.id]);
    t.edges.telegram.failures.set(c.telegramId, [
      new Error('chat not found'),
      new Error('chat not found'),
    ]);
    await expect(svc.process(job(b.id, c.id, 0), worker)).rejects.toThrow('chat not found');
    expect((await t.db.select().from(broadcastDeliveries))[0]?.status).toBe('pending');
    await svc.process(job(b.id, c.id, BROADCAST_ATTEMPTS - 1), worker);
    const [d] = await t.db.select().from(broadcastDeliveries);
    expect(d).toMatchObject({ status: 'failed', error: expect.stringContaining('chat not found') });
    const [cust] = await t.db.select().from(customers).where(eq(customers.id, c.id));
    expect(cust?.botBlocked).toBe(false);
    expect((await counts(b.id)).counts).toMatchObject({ failed: 1, pending: 0, sent: 0 });
  });

  it('re-queues a pending delivery the queue lost (the minute sweep)', async () => {
    const c = await customer();
    const b = await seed([c.id]);
    expect(await svc.dispatch()).toBe(1);
    await finished(b.id);
    expect(t.edges.telegram.sent).toHaveLength(1);
  });

  it('re-checks the skip rules when the job runs', async () => {
    const c = await customer();
    const b = await seed([c.id]);
    await t.db.update(customers).set({ writeAccess: 'refused' }).where(eq(customers.id, c.id));
    await svc.process(job(b.id, c.id), worker);
    expect(t.edges.telegram.sent).toHaveLength(0);
    expect((await t.db.select().from(broadcastDeliveries))[0]?.status).toBe('blocked');
  });
});

describe('«Отправить себе»', () => {
  it('sends both language versions to the owner and records no broadcast', async () => {
    await customer();
    const res = await owner.client.admin.broadcasts.test({
      body: body({ buttonTarget: 'orders' }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: ['ru', 'uz'] });
    expect(t.edges.telegram.sent.map((m) => [m.chatId, m.text])).toEqual([
      [owner.staff.telegramId, 'Новый аромат уже в LUMMI.'],
      [owner.staff.telegramId, 'LUMMI’da yangi atir bor.'],
    ]);
    expect(await t.db.select().from(broadcasts)).toHaveLength(0);
    const entries = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'broadcast.test_sent'));
    expect(entries).toHaveLength(1);
  });

  it('says so when the owner has not started the bot (403)', async () => {
    t.edges.telegram.blockedChats.add(owner.staff.telegramId);
    const res = await owner.client.admin.broadcasts.test({ body: body() });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ code: 'test_blocked' });
  });
});

describe('results', () => {
  it('lists past broadcasts newest first with counts', async () => {
    const c = await customer();
    const a = await create(body({ textRu: 'Первая' }));
    await finished(a.body.id as number);
    const b = await create(body({ textRu: 'Вторая' }));
    await finished(b.body.id as number);
    const list = await owner.client.admin.broadcasts.list();
    expect(list.status).toBe(200);
    expect((list.body as { textRu: string }[]).map((x) => x.textRu)).toEqual(['Вторая', 'Первая']);
    expect((list.body as { counts: { sent: number } }[])[0]?.counts.sent).toBe(1);
    expect(c.id).toBeGreaterThan(0);
  });
});

describe('order messages after a broadcast', () => {
  it('a customer who never started the bot gets no job, and their order messages still go out', async () => {
    const lurker = await customer({ writeAccess: null });
    const res = await create(body());
    expect(res.body.counts).toMatchObject({ total: 1, blocked: 1, pending: 0 });
    expect(t.edges.telegram.sent).toHaveLength(0);
    const [row] = await t.db.select().from(customers).where(eq(customers.id, lurker.id));
    expect(row?.botBlocked).toBe(false);
    await t.app
      .get(OutboxService)
      .withTx((tx) =>
        t.app
          .get(OutboxService)
          .enqueue(tx, { chatId: lurker.telegramId, text: 'Заказ собирается' }),
      );
    await vi.waitFor(() =>
      expect(t.edges.telegram.sent.map((m) => m.text)).toEqual(['Заказ собирается']),
    );
  });

  it("a 403 «can't initiate» counts not delivered without flagging the customer", async () => {
    const c = await customer(); // granted, but Telegram still refuses to start the chat
    t.edges.telegram.failures.set(c.telegramId, [new BotBlockedError(c.telegramId, true)]);
    const b = await seed([c.id]);
    await svc.process(job(b.id, c.id), worker);
    expect((await t.db.select().from(broadcastDeliveries))[0]).toMatchObject({ status: 'blocked' });
    const [row] = await t.db.select().from(customers).where(eq(customers.id, c.id));
    expect(row?.botBlocked).toBe(false);
    await t.app
      .get(OutboxService)
      .withTx((tx) =>
        t.app.get(OutboxService).enqueue(tx, { chatId: c.telegramId, text: 'Заказ создан' }),
      );
    await vi.waitFor(() =>
      expect(t.edges.telegram.sent.map((m) => m.text)).toEqual(['Заказ создан']),
    );
  });

  it('a real block (403 «blocked by the user») flags the customer', async () => {
    const c = await customer();
    t.edges.telegram.failures.set(c.telegramId, [new BotBlockedError(c.telegramId)]);
    const b = await seed([c.id]);
    await svc.process(job(b.id, c.id), worker);
    const [row] = await t.db.select().from(customers).where(eq(customers.id, c.id));
    expect(row?.botBlocked).toBe(true);
  });

  it('never reaches a customer the order messages would skip', async () => {
    const people = [
      await customer({ writeAccess: 'granted' }),
      await customer({ writeAccess: 'granted', botBlocked: true }),
      await customer({ writeAccess: 'refused' }),
      await customer({ writeAccess: null }),
    ];
    const res = await create(body());
    const sendable = await t.db
      .select()
      .from(broadcastDeliveries)
      .where(eq(broadcastDeliveries.status, 'pending'));
    for (const d of sendable) {
      const p = people.find((x) => x.id === d.customerId)!;
      expect(await t.app.get(CustomersService).canMessage(p.telegramId)).toBe(true);
    }
    await finished(res.body.id);
  });
});

describe('the photo', () => {
  async function withImage() {
    const png = await sharp({
      create: { width: 600, height: 800, channels: 3, background: '#CFC6B8' },
    })
      .png()
      .toBuffer();
    t.edges.files.files.set('broadcasts/0123456789abcdef.png', new Uint8Array(png));
    return 'broadcasts/0123456789abcdef.png';
  }

  it("uploads once, keeps Telegram's file_id, and sends by id afterwards", async () => {
    const key = await withImage();
    const people = [await customer(), await customer(), await customer()];
    const b = await seed(
      people.map((p) => p.id),
      { imageKey: key },
    );
    await svc.process(job(b.id, people[0]!.id), worker);
    const [first] = await t.db.select().from(broadcasts).where(eq(broadcasts.id, b.id));
    expect(first?.photoFileId).toBe('file-1');
    await svc.process(job(b.id, people[1]!.id), worker);
    await svc.process(job(b.id, people[2]!.id), worker);
    expect(t.edges.telegram.sent.map((m) => m.photo)).toEqual([
      { bytes: expect.anything() },
      { fileId: 'file-1' },
      { fileId: 'file-1' },
    ]);
  });

  it('uploads again when Telegram rejects the file_id', async () => {
    const key = await withImage();
    const c = await customer();
    const b = await seed([c.id], { imageKey: key, photoFileId: 'stale' });
    t.edges.telegram.rejectedFileIds.add('stale');
    await svc.process(job(b.id, c.id), worker);
    expect(t.edges.telegram.sent).toHaveLength(1);
    expect(t.edges.telegram.sent[0]?.photo).toEqual({ bytes: expect.anything() });
    expect((await t.db.select().from(broadcastDeliveries))[0]?.status).toBe('sent');
  });
});

describe('relink (ADR 0032)', () => {
  it('moves the deliveries to the surviving customer without changing the counts', async () => {
    const older = await customer();
    const fresh = await customer();
    const other = await customer();
    const b1 = await seed([older.id, fresh.id, other.id]);
    const b2 = await seed([fresh.id]);
    await t.db.update(broadcastDeliveries).set({ status: 'sent' });
    const before = (await counts(b1.id)).counts;
    await t.db.transaction((tx) => moveCustomerData(tx, fresh.id, older.id, new Date()));
    // the clash on b1 keeps the older customer's row, so b1 loses only the duplicate
    expect((await counts(b1.id)).counts.total).toBe(before.total - 1);
    expect((await counts(b2.id)).counts).toMatchObject({ total: 1, sent: 1 });
    const rows = await t.db.select().from(broadcastDeliveries);
    expect(rows.some((r) => r.customerId === fresh.id)).toBe(false);
  });
});

describe('the worker', () => {
  it('starts even when the rate setting cannot be read, and still delivers', async () => {
    const t2 = await createTestApp();
    try {
      await t2.reset();
      const settings = t2.app.get(SettingsService);
      const real = settings.get.bind(settings);
      vi.spyOn(settings, 'get').mockImplementation(((key: string, ...rest: unknown[]) =>
        key === 'broadcast.sendRatePerSecond'
          ? Promise.reject(new Error('settings table unreadable'))
          : (real as (...a: unknown[]) => unknown)(key, ...rest)) as never);
      t2.startWorker();
      const owner2 = await t2.ownerSession();
      const [c] = await t2.db
        .insert(customers)
        .values({ telegramId: 777001, firstName: 'Ali', language: 'ru', writeAccess: 'granted' })
        .returning();
      const res = await owner2.client.admin.broadcasts.create({ body: body() });
      expect(res.status).toBe(201);
      await vi.waitFor(
        () => expect(t2.edges.telegram.sent.map((m) => m.chatId)).toEqual([c!.telegramId]),
        {
          timeout: 10_000,
        },
      );
    } finally {
      await t2.close();
    }
  });
});
