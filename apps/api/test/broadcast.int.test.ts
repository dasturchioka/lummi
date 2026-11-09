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
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitedError } from '../src/edges';
import { BROADCAST_ATTEMPTS, BroadcastService } from '../src/broadcast/broadcast.service';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

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
    const all = await owner.client.admin.broadcasts.audience({ query: { audience: 'all' } });
    expect(all.body).toEqual({ total: 3, reachable: 1 });
    const ru = await owner.client.admin.broadcasts.audience({ query: { audience: 'ru' } });
    expect(ru.body).toEqual({ total: 2, reachable: 1 });
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
    expect(Buffer.from(to(ru.telegramId).photo!).equals(png)).toBe(true);
    expect(to(ru.telegramId).options).toEqual({
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: dictionaries.ru.bot.broadcastOpen,
              url: 'https://t.me/Lummiuz_bot?startapp=catalog',
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
      payload: { audience: 'all', recipients: 2, sender: owner.staff.name },
    });
    await finished(res.body.id as number);
    expect(res.body.createdByName).toBe(owner.staff.name);
  });
});

describe('jobs', () => {
  it('is idempotent: a retried job after a send sends nothing', async () => {
    const c = await customer();
    const b = await seed([c.id]);
    await svc.process(job(b.id, c.id));
    await svc.process(job(b.id, c.id)); // the queue redelivers it
    expect(await svc.deliver(b.id, c.id)).toBe('skipped');
    expect(t.edges.telegram.sent).toHaveLength(1);
  });

  it('holds back two concurrent attempts on one delivery', async () => {
    const c = await customer();
    const b = await seed([c.id]);
    await Promise.all([svc.deliver(b.id, c.id), svc.deliver(b.id, c.id)]);
    expect(t.edges.telegram.sent).toHaveLength(1);
  });

  it('retries after a 429 and then sends once', async () => {
    const c = await customer();
    const b = await seed([c.id]);
    t.edges.telegram.failures.set(c.telegramId, [new RateLimitedError(3)]);
    await expect(svc.process(job(b.id, c.id))).rejects.toBeInstanceOf(RateLimitedError);
    expect((await t.db.select().from(broadcastDeliveries))[0]).toMatchObject({
      status: 'pending',
      sendingAt: null,
    });
    await svc.process(job(b.id, c.id, 1));
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
    await expect(svc.process(job(b.id, c.id, 0))).rejects.toThrow('chat not found');
    expect((await t.db.select().from(broadcastDeliveries))[0]?.status).toBe('pending');
    await svc.process(job(b.id, c.id, BROADCAST_ATTEMPTS - 1));
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
    await svc.process(job(b.id, c.id));
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
