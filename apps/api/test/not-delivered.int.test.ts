import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { birthdayCoupons, eq, orders, reviews } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { orderBody, samarkandPoint, shopper, slugs as slugsOf } from './harness/orders';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028) for the «не доставлено» views (#55): the review requests of «Отзывы» (sent,
 * answered, not delivered; days and state filters) and the owner's birthday coupons list
 * (delivered or not, used or not, by year).
 */
const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-16T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir, limit: 3 });
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const ali: TestUser = { id: 91, first_name: 'Ali', last_name: 'Valiyev' };
const vali: TestUser = { id: 92, first_name: 'Vali' };
const sora: TestUser = { id: 93, first_name: 'Sora', last_name: 'Karimova' };

/** An order placed through the API; returns its number and its customer's id. */
async function place(user: TestUser, phone: string) {
  const [slug] = await slugsOf(t, 1);
  const client = await shopper(t, user, phone);
  await client.cart.addLine({ body: { slug: slug!, ml: 10, qty: 1 } });
  const point = await samarkandPoint(t);
  const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  const [o] = await t.db.select().from(orders).where(eq(orders.number, res.body.number));
  return { id: o!.id, number: o!.number, customerId: o!.customerId };
}

async function request(
  orderId: number,
  outcome: 'sent' | 'not_delivered',
  at: string,
  rating?: number,
) {
  await t.db
    .update(orders)
    .set({ reviewRequest: outcome, reviewRequestedAt: new Date(at) })
    .where(eq(orders.id, orderId));
  if (rating !== undefined) {
    const [o] = await t.db.select().from(orders).where(eq(orders.id, orderId));
    await t.db
      .insert(reviews)
      .values({ orderId, customerId: o!.customerId, rating, step: 'done' } as never);
  }
}

describe('review requests', () => {
  async function seed() {
    const a = await place(ali, '998901111111');
    const b = await place(vali, '998902222222');
    const c = await place(sora, '998903333333');
    const d = await place(ali, '998901111111'); // no request yet: not listed
    await request(a.id, 'sent', '2026-11-10T08:00:00Z', 5); // answered
    await request(b.id, 'not_delivered', '2026-11-12T08:00:00Z');
    await request(c.id, 'sent', '2026-11-14T08:00:00Z'); // asked, no answer yet
    return { a, b, c, d };
  }
  const list = (query: object) => owner.client.admin.reviews.requests({ query: query as never });

  it('lists every request with its derived state, newest first, and counts each state', async () => {
    const { a, b, c } = await seed();
    const res = await list({});
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.items.map((i) => [i.orderNumber, i.state])).toEqual([
      [c.number, 'sent'],
      [b.number, 'not_delivered'],
      [a.number, 'answered'],
    ]);
    expect(res.body.items[2]).toMatchObject({ rating: 5, customerName: 'Ali Valiyev' });
    expect(res.body.items[1]).toMatchObject({ rating: null, customerName: 'Vali' });
    expect(res.body.counts).toEqual({ not_delivered: 1, sent: 1, answered: 1 });
    expect(res.body.total).toBe(3);
  });

  it('filters «не доставлено», sent and answered; the counts ignore the state filter', async () => {
    const { a, b, c } = await seed();
    for (const [state, number] of [
      ['not_delivered', b.number],
      ['sent', c.number],
      ['answered', a.number],
    ] as const) {
      const res = await list({ state });
      if (res.status !== 200) throw new Error('list');
      expect(res.body.items.map((i) => i.orderNumber)).toEqual([number]);
      expect(res.body.total).toBe(1);
      expect(res.body.counts).toEqual({ not_delivered: 1, sent: 1, answered: 1 });
    }
  });

  it('filters by the Tashkent days of the request', async () => {
    const { b, c } = await seed();
    // 2026-11-12T08:00Z is 13:00 on the 12th in Tashkent; 14th 13:00 likewise
    const res = await list({ from: '2026-11-12', to: '2026-11-14' });
    if (res.status !== 200) throw new Error('list');
    expect(res.body.items.map((i) => i.orderNumber)).toEqual([c.number, b.number]);
    expect(res.body.counts).toEqual({ not_delivered: 1, sent: 1, answered: 0 });
    const none = await list({ from: '2026-11-13', to: '2026-11-13' });
    if (none.status !== 200) throw new Error('list');
    expect(none.body.items).toEqual([]);
    expect(none.body.total).toBe(0);
  });

  it('pages, and a manager may read it', async () => {
    await seed();
    const res = await manager.client.admin.reviews.requests({
      query: { page: 2, pageSize: 2 } as never,
    });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(3);
  });
});

describe('birthday coupons', () => {
  async function coupon(
    customerId: number,
    year: number,
    over: Partial<typeof birthdayCoupons.$inferInsert> = {},
  ) {
    const [row] = await t.db
      .insert(birthdayCoupons)
      .values({
        customerId,
        birthdayYear: year,
        birthday: `${year}-11-20`,
        percent: 20,
        maxAmount: 100_000,
        issuedAt: new Date(`${year}-11-10T05:00:00Z`),
        expiresAt: new Date(`${year}-11-25T19:00:00Z`),
        outboxId: 1,
        ...over,
      })
      .returning();
    return row!;
  }
  const list = (query: object) =>
    owner.client.admin.birthdayCoupons.list({ query: query as never });

  async function seed() {
    const a = await place(ali, '998901111111');
    const b = await place(vali, '998902222222');
    const c = await place(sora, '998903333333');
    // delivered, used on order a
    const used = await coupon(a.customerId, 2026, { usedByOrderId: a.id });
    // not delivered (the bot was blocked), still active
    const lost = await coupon(b.customerId, 2026, { outboxId: null });
    // last year's: delivered, expired unused
    const old = await coupon(c.customerId, 2025);
    return { a, b, c, used, lost, old };
  }

  it('lists customer, year, terms, delivery, the order and the derived state', async () => {
    const { a, used, lost, old } = await seed();
    const res = await list({});
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    expect(res.body.items.map((i) => i.id)).toEqual([lost.id, used.id, old.id]);
    const byId = new Map(res.body.items.map((i) => [i.id, i]));
    expect(byId.get(used.id)).toMatchObject({
      customerName: 'Ali Valiyev',
      birthdayYear: 2026,
      percent: 20,
      maxAmount: 100_000,
      delivered: true,
      usedOrderNumber: a.number,
      state: 'used',
    });
    expect(byId.get(lost.id)).toMatchObject({
      delivered: false,
      usedOrderNumber: null,
      state: 'active',
    });
    expect(byId.get(old.id)).toMatchObject({ state: 'expired', birthdayYear: 2025 });
    expect(res.body.total).toBe(3);
    expect(res.body.notDelivered).toBe(1);
    expect(res.body.years).toEqual([2026, 2025]);
  });

  it('filters by year, delivery state and use', async () => {
    const { used, lost, old } = await seed();
    const ids = async (query: object) => {
      const res = await list(query);
      if (res.status !== 200) throw new Error('list');
      return res.body.items.map((i) => i.id).sort((x, y) => x - y);
    };
    const sorted = (...xs: number[]) => xs.sort((x, y) => x - y);
    expect(await ids({ year: 2025 })).toEqual([old.id]);
    expect(await ids({ delivery: 'not_delivered' })).toEqual([lost.id]);
    expect(await ids({ delivery: 'delivered' })).toEqual(sorted(used.id, old.id));
    expect(await ids({ used: 'used' })).toEqual([used.id]);
    expect(await ids({ used: 'unused' })).toEqual(sorted(lost.id, old.id));
    expect(await ids({ year: 2026, delivery: 'delivered', used: 'unused' })).toEqual([]);
    const lostOnly = await list({ delivery: 'not_delivered' });
    if (lostOnly.status !== 200) throw new Error('list');
    expect(lostOnly.body.notDelivered).toBe(1);
    expect(lostOnly.body.total).toBe(1);
    // the year list is the whole picture, not the filtered one
    expect(lostOnly.body.years).toEqual([2026, 2025]);
  });

  it('is the owner’s: a manager gets 403', async () => {
    await seed();
    const res = await manager.client.admin.birthdayCoupons.list({ query: {} as never });
    expect(res.status).toBe(403);
  });

  it('shows an empty list', async () => {
    const res = await list({});
    if (res.status !== 200) throw new Error('list');
    expect(res.body).toMatchObject({ items: [], total: 0, notDelivered: 0, years: [] });
  });
});
