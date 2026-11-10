import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody, PromoCodeInput } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import { and, auditLog, btsPoints, eq, fragrances, regions, volumes } from '@lummi/db';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { DiscountSourceHooks } from '../src/order-status/discount-sources';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028) for promo codes (ticket #29): the owner's admin, the cart's code field, the
 * use held by `createOrder` under the code's row lock, and the cancel that voids it. Seed prices:
 * 10 ml 69 000, 30 ml 149 000, 50 ml 219 000; the default tariff 25 000 below 250 000.
 */
const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let owner: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
});
afterEach(() => vi.restoreAllMocks());

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));

/** A percent code with no limits, active; `over` changes any field. */
function promo(over: Partial<PromoCodeInput> = {}): PromoCodeInput {
  return {
    code: 'BLOGER10',
    kind: 'percent',
    percent: 10,
    amount: null,
    maxDiscount: null,
    expiresOn: null,
    minOrderTotal: null,
    totalLimit: null,
    perCustomerLimit: null,
    newCustomersOnly: false,
    appliesToMarkedDown: false,
    active: true,
    ...over,
  };
}
async function createPromo(over: Partial<PromoCodeInput> = {}) {
  const res = await owner.client.admin.promoCodes.create({ body: promo(over) });
  if (res.status !== 201)
    throw new Error(`create promo: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

describe('admin: promo codes are the owner’s', () => {
  it('creates a code trimmed and upper-case, with every field, audited', async () => {
    const res = await owner.client.admin.promoCodes.create({
      body: promo({
        code: '  bloger10 ',
        maxDiscount: 30_000,
        expiresOn: '2026-11-30',
        minOrderTotal: 150_000,
        totalLimit: 100,
        perCustomerLimit: 1,
        newCustomersOnly: true,
        appliesToMarkedDown: true,
      }),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: 'BLOGER10',
      kind: 'percent',
      percent: 10,
      amount: null,
      maxDiscount: 30_000,
      expiresOn: '2026-11-30',
      minOrderTotal: 150_000,
      totalLimit: 100,
      perCustomerLimit: 1,
      newCustomersOnly: true,
      appliesToMarkedDown: true,
      active: true,
      uses: 0,
      everUsed: false,
      state: 'active',
    });
    const [entry] = await audits('promo.created');
    expect(entry).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetType: 'promo_code',
      payload: { code: 'BLOGER10' },
    });

    const list = await owner.client.admin.promoCodes.list();
    expect(list.status === 200 && list.body.map((p) => p.code)).toEqual(['BLOGER10']);
  });

  it('refuses a code that exists in another case (409) and one that breaks the rules (400)', async () => {
    await createPromo({ code: 'LUMMI10' });
    const dup = await owner.client.admin.promoCodes.create({ body: promo({ code: 'lummi10' }) });
    expect(dup).toMatchObject({ status: 409, body: { code: 'code_taken' } });

    // the contract's body schema refuses these before the handler
    const post = (body: PromoCodeInput) =>
      fetch(`${t.baseUrl}/admin/promo-codes`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const fixedWithPercent = promo({ code: 'MINUS20', kind: 'fixed', percent: 10, amount: 20_000 });
    expect((await post(fixedWithPercent)).status).toBe(400);
    expect((await post(promo({ code: 'ЛУММИ' }))).status).toBe(400);
    expect((await post(promo({ code: 'AB' }))).status).toBe(400);
    expect(
      (await post(promo({ code: 'MINUS20', kind: 'fixed', percent: null, amount: 20_000 }))).status,
    ).toBe(201);
    expect(await owner.client.admin.promoCodes.list()).toMatchObject({
      body: [{ code: 'MINUS20', kind: 'fixed', amount: 20_000 }, { code: 'LUMMI10' }],
    });
  });

  it('edits a code with the changed fields in the audit; a save that changes nothing writes nothing', async () => {
    const created = await createPromo();
    const same = await owner.client.admin.promoCodes.update({
      params: { id: created.id },
      body: promo(),
    });
    expect(same.status).toBe(200);
    expect(await audits('promo.updated')).toHaveLength(0);

    const res = await owner.client.admin.promoCodes.update({
      params: { id: created.id },
      body: promo({ percent: 15, active: false }),
    });
    expect(res).toMatchObject({
      status: 200,
      body: { percent: 15, active: false, state: 'inactive' },
    });
    const [entry] = await audits('promo.updated');
    expect(entry?.payload).toEqual({
      code: 'BLOGER10',
      changed: { percent: [10, 15], active: [true, false] },
    });
  });

  it('deletes a code no order took, audited', async () => {
    const created = await createPromo();
    const res = await owner.client.admin.promoCodes.remove({ params: { id: created.id } });
    expect(res.status).toBe(200);
    expect(await owner.client.admin.promoCodes.list()).toMatchObject({ body: [] });
    expect(await audits('promo.deleted')).toHaveLength(1);
  });

  it('answers a manager 403 on every promo route', async () => {
    const created = await createPromo();
    const m = (await t.managerSession()).client.admin.promoCodes;
    const calls = [
      m.list(),
      m.get({ params: { id: created.id } }),
      m.create({ body: promo({ code: 'OTHER1' }) }),
      m.update({ params: { id: created.id }, body: promo() }),
      m.remove({ params: { id: created.id } }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
  });
});

/** A signed-in shopper who shared a phone (ADR 0004), with cart helpers. */
async function shopper(user: TestUser = ali, phone = '998901234567') {
  const { client } = await t.signIn(user);
  const proof = signContact({
    botToken: TEST_BOT_TOKEN,
    userId: user.id,
    phone,
    authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
  });
  if ((await client.me.shareContact({ body: { proof } })).status !== 200)
    throw new Error('contact');
  const add = async (slug: string, ml: 10 | 30 | 50, qty = 1) => {
    const res = await client.cart.addLine({ body: { slug, ml, qty } });
    if (res.status !== 200) throw new Error(`add ${slug}: ${res.status}`);
    return res.body;
  };
  const apply = async (code: string) => {
    const res = await client.cart.applyPromoCode({ body: { code } });
    if (res.status !== 200) throw new Error(`apply ${code}: ${res.status}`);
    return res.body;
  };
  return { client, add, apply };
}
type Shopper = Awaited<ReturnType<typeof shopper>>;

async function slugs(n: number) {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows
    .map((r) => r.slug)
    .sort()
    .slice(0, n);
}

async function setPrice(slug: string, ml: number, price: number) {
  const [v] = await t.db
    .select({ id: volumes.id })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, ml)));
  await t.db.update(volumes).set({ price }).where(eq(volumes.id, v!.id));
}

async function markDown(slug: string, ml: number, salePrice: number) {
  const [v] = await t.db
    .select({ id: volumes.id })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, ml)));
  await t.db.update(volumes).set({ salePrice, saleEndsAt: null }).where(eq(volumes.id, v!.id));
}

/** The checkout body for the cart as it is now, to a Samarkand point, at the total quoted now. */
async function orderBody(s: Shopper): Promise<CreateOrderBody> {
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  const checkout = await s.client.checkout.get({ query: { regionId: region!.id } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  return {
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998901234567',
    delivery: { kind: 'point', pointId: point!.id },
    consent: true,
    confirmedTotal: checkout.body.quote.total,
    confirmedDiscount: checkout.body.quote.discount,
    idempotencyKey: randomUUID(),
  };
}
async function placeOrder(s: Shopper) {
  const res = await s.client.orders.create({ body: await orderBody(s) });
  if (res.status !== 201) throw new Error(`order ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
async function cancel(s: Shopper, number: number) {
  const res = await s.client.orders.cancel({
    params: { number },
    body: { expectedStatus: 'awaiting_payment' },
  });
  if (res.status !== 200) throw new Error(`cancel ${res.status}`);
}
async function quoteOf(s: Shopper) {
  const cart = await s.client.cart.get();
  if (cart.status !== 200) throw new Error(`cart ${cart.status}`);
  return cart.body.quote;
}

describe('the cart: a typed code', () => {
  it('applies a code typed in any case as the order’s one discount, and removes it', async () => {
    const [a, b] = await slugs(2);
    const s = await shopper();
    await s.add(a!, 30);
    await s.add(b!, 30);
    await createPromo();

    const cart = await s.apply(' bloger10 ');
    // 298 000 of items, 10% = 29 800; 268 200 after it still ships free (promo base "after")
    expect(cart.promoCode).toBe('BLOGER10');
    expect(cart.quote).toMatchObject({
      itemsSubtotal: 298_000,
      discount: { type: 'promo_code', code: 'BLOGER10', amount: 29_800 },
      thresholdBase: 'after',
      deliveryFee: 0,
      total: 268_200,
      promoCode: { code: 'BLOGER10', invalid: null },
    });

    const removed = await s.client.cart.removePromoCode();
    expect(removed.status === 200 && removed.body).toMatchObject({
      promoCode: null,
      quote: { discount: null, total: 298_000, promoCode: null },
    });
  });

  it.each([
    ['unknown', 'NOSUCH', {}],
    ['inactive', 'BLOGER10', { active: false }],
    ['below_minimum', 'BLOGER10', { minOrderTotal: 300_000 }],
  ] as const)(
    'an invalid code (%s) says why and never blocks the order, which holds no use',
    async (reason, typed, over) => {
      const [a, b] = await slugs(2);
      const s = await shopper();
      await s.add(a!, 30);
      await s.add(b!, 30);
      await createPromo(over);

      const cart = await s.apply(typed);
      expect(cart.quote).toMatchObject({
        discount: null,
        total: 298_000,
        promoCode: { code: typed, invalid: { reason } },
      });
      const order = await placeOrder(s);
      expect(order).toMatchObject({ discount: null, total: 298_000 });
      const [code] = (await owner.client.admin.promoCodes.list()).body as { uses: number }[];
      expect(code?.uses).toBe(0);
      // the refused code went with the order too, so the next cart does not greet with a refusal
      expect((await s.client.cart.get()).body).toMatchObject({ promoCode: null });
    },
  );

  it('works through 23:59:59 Tashkent on its last day and is expired from 00:00 the next', async () => {
    t.edges.clock.set(new Date('2026-11-15T18:30:00Z'));
    const [a] = await slugs(1);
    const s = await shopper();
    await s.add(a!, 50);
    await createPromo({ expiresOn: '2026-11-15' });
    await s.apply('BLOGER10');

    // 2026-11-15 23:59:59.999 in Tashkent (UTC+5)
    t.edges.clock.set(new Date('2026-11-15T18:59:59.999Z'));
    expect(await quoteOf(s)).toMatchObject({
      discount: { amount: 21_900 },
      promoCode: { invalid: null },
    });
    t.edges.clock.set(new Date('2026-11-15T19:00:00Z'));
    expect(await quoteOf(s)).toMatchObject({
      discount: null,
      total: 219_000 + 25_000,
      promoCode: { code: 'BLOGER10', invalid: { reason: 'expired' } },
    });
    const [listed] = (await owner.client.admin.promoCodes.list()).body as { state: string }[];
    expect(listed?.state).toBe('expired');
  });

  it('skips marked-down items unless the code is flagged for them', async () => {
    const [a, b] = await slugs(2);
    const s = await shopper();
    await markDown(a!, 30, 120_000);
    await s.add(a!, 30);
    await s.add(b!, 30);
    const created = await createPromo();
    // 120 000 marked down + 149 000 regular: 10% of the regular one only
    expect((await s.apply('BLOGER10')).quote).toMatchObject({
      itemsSubtotal: 269_000,
      discount: { amount: 14_900 },
      total: 254_100,
    });
    await owner.client.admin.promoCodes.update({
      params: { id: created.id },
      body: promo({ appliesToMarkedDown: true }),
    });
    expect(await quoteOf(s)).toMatchObject({
      discount: { amount: 26_900 },
      total: 242_100 + 25_000,
    });
  });

  it('a set takes the code like any item and the order holds it; a marked-down bottle beside it does not', async () => {
    const [a] = await slugs(1);
    const s = await shopper();
    await markDown(a!, 30, 120_000);
    await s.add(a!, 30);
    expect((await s.client.cart.addDiscovery({ body: { qty: 1 } })).status).toBe(200);
    await createPromo();
    // the Discovery set at 299 000 and a bottle marked down to 120 000: 10 % of the set only
    expect((await s.apply('BLOGER10')).quote).toMatchObject({
      itemsSubtotal: 419_000,
      discount: { type: 'promo_code', code: 'BLOGER10', amount: 29_900 },
      deliveryFee: 0,
      total: 389_100,
    });
    expect(await placeOrder(s)).toMatchObject({
      discount: { type: 'promo_code', code: 'BLOGER10', amount: 29_900 },
      total: 389_100,
    });
    expect(await usesOf()).toMatchObject({ uses: 1 });
  });

  it('says so when every item is marked down and the code is not flagged for them', async () => {
    const [a] = await slugs(1);
    const s = await shopper();
    await markDown(a!, 30, 120_000);
    await s.add(a!, 30);
    await createPromo();
    expect((await s.apply('BLOGER10')).quote).toMatchObject({
      discount: null,
      promoCode: { invalid: { reason: 'no_eligible_items' } },
    });
  });
});

const usesOf = async (code = 'BLOGER10') => {
  const list = await owner.client.admin.promoCodes.list();
  if (list.status !== 200) throw new Error(`list ${list.status}`);
  return list.body.find((p) => p.code === code)!;
};

/**
 * Runs `run` while another session holds an EXCLUSIVE lock on `table` (reads pass, writes wait),
 * and releases it only once `waiters` sessions are blocked on a lock: the race is then real, not
 * a hope that two requests overlapped within some fixed time.
 */
async function whileTableLocked<T>(table: string, waiters: number, run: () => Promise<T>) {
  const locker = new pg.Client({ connectionString: t.env.DATABASE_URL });
  await locker.connect();
  try {
    await locker.query('begin');
    await locker.query(`lock table ${table} in exclusive mode`);
    const pending = run();
    for (const deadline = Date.now() + 10_000; ;) {
      const { rows } = await locker.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
         where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
      );
      if (rows[0]!.n >= waiters) break;
      if (Date.now() > deadline)
        throw new Error(`only ${rows[0]!.n} of ${waiters} sessions reached a lock`);
      await new Promise((r) => setTimeout(r, 20));
    }
    await locker.query('commit');
    return await pending;
  } finally {
    await locker.end();
  }
}

describe('the order holds a use; the limits count uses that were not voided', () => {
  it('the order keeps the code as its discount and holds one use', async () => {
    const [a, b] = await slugs(2);
    const s = await shopper();
    await s.add(a!, 30);
    await s.add(b!, 30);
    await createPromo({ totalLimit: 5 });
    await s.apply('BLOGER10');
    const order = await placeOrder(s);
    expect(order).toMatchObject({
      discount: { type: 'promo_code', code: 'BLOGER10', amount: 29_800 },
      total: 268_200,
    });
    expect(await usesOf()).toMatchObject({ uses: 1, everUsed: true, totalLimit: 5 });
    // the order took the code with it: the next cart starts without one
    expect((await s.client.cart.get()).body).toMatchObject({ promoCode: null });
  });

  it('total limit: the last use goes to one shopper, the next is told it is exhausted; a cancel gives it back', async () => {
    const [a, b] = await slugs(2);
    await createPromo({ totalLimit: 1 });
    const first = await shopper(ali);
    await first.add(a!, 30);
    await first.apply('BLOGER10');
    const taken = await placeOrder(first);
    expect(await usesOf()).toMatchObject({ uses: 1, state: 'exhausted' });

    const second = await shopper(vali, '998901112233');
    await second.add(b!, 30);
    expect((await second.apply('BLOGER10')).quote).toMatchObject({
      discount: null,
      promoCode: { code: 'BLOGER10', invalid: { reason: 'exhausted' } },
    });

    // the cancel voids the use through the discount-source release (ADR 0005), in its transaction
    const release = vi.spyOn(t.app.get(DiscountSourceHooks), 'release');
    await cancel(first, taken.number);
    expect(release).toHaveBeenCalledTimes(1);
    expect(await usesOf()).toMatchObject({ uses: 0, everUsed: true, state: 'active' });
    expect(await quoteOf(second)).toMatchObject({
      discount: { type: 'promo_code', amount: 14_900 },
      promoCode: { invalid: null },
    });
  });

  it('per-customer limit: the shopper’s own use is counted, other shoppers still get it; a cancel frees it', async () => {
    const [a, b] = await slugs(2);
    await createPromo({ perCustomerLimit: 1 });
    const s = await shopper(ali);
    await s.add(a!, 30);
    await s.apply('BLOGER10');
    const order = await placeOrder(s);
    await s.add(b!, 30);
    expect((await s.apply('BLOGER10')).quote).toMatchObject({
      discount: null,
      promoCode: { invalid: { reason: 'already_used' } },
    });
    const other = await shopper(vali, '998901112233');
    await other.add(b!, 30);
    expect((await other.apply('BLOGER10')).quote).toMatchObject({ promoCode: { invalid: null } });

    await cancel(s, order.number);
    expect(await quoteOf(s)).toMatchObject({ promoCode: { invalid: null } });
  });

  it('new customers only: refused once the shopper has another non-cancelled order, fine again after a cancel', async () => {
    const [a, b] = await slugs(2);
    await createPromo({ newCustomersOnly: true });
    const s = await shopper();
    await s.add(a!, 30);
    // the shopper's first order, without the code
    const first = await placeOrder(s);
    await s.add(b!, 30);
    expect((await s.apply('BLOGER10')).quote).toMatchObject({
      discount: null,
      promoCode: { invalid: { reason: 'not_new_customer' } },
    });
    await cancel(s, first.number);
    const order = await placeOrder(s);
    expect(order.discount).toMatchObject({ type: 'promo_code', code: 'BLOGER10' });
  });

  it('two concurrent orders for the last use: exactly one holds it, the other gets 409 with the new quote', async () => {
    const [a, b] = await slugs(2);
    await createPromo({ totalLimit: 1 });
    const first = await shopper(ali);
    const second = await shopper(vali, '998901112233');
    // different bottles, so no stock row orders the two: only the code's own lock can
    await first.add(a!, 30);
    await second.add(b!, 30);
    await first.apply('BLOGER10');
    await second.apply('BLOGER10');
    const bodies = [await orderBody(first), await orderBody(second)] as const;
    expect(bodies.map((b) => b.confirmedTotal)).toEqual([159_100, 159_100]);

    // Both requests run while no use can be written yet, so each would count the uses before the
    // other held one: only the row lock on the code keeps the second from taking it too.
    const results = await whileTableLocked('promo_code_uses', 2, () =>
      Promise.all([
        first.client.orders.create({ body: bodies[0] }),
        second.client.orders.create({ body: bodies[1] }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)).toMatchObject({
      body: {
        code: 'total_changed',
        checkout: {
          quote: {
            discount: null,
            total: 174_000,
            promoCode: { code: 'BLOGER10', invalid: { reason: 'exhausted' } },
          },
        },
      },
    });
    expect(results.find((r) => r.status === 201)).toMatchObject({
      body: { discount: { type: 'promo_code', code: 'BLOGER10', amount: 14_900 } },
    });
    expect(await usesOf()).toMatchObject({ uses: 1, state: 'exhausted' });
  });

  it('expiry at the order: held at 23:59:59 Tashkent on the last day, 409 from 00:00 the next', async () => {
    const [a, b] = await slugs(2);
    await createPromo({ expiresOn: '2026-11-15' });
    t.edges.clock.set(new Date('2026-11-15T18:59:59Z')); // 23:59:59 in Tashkent (UTC+5)
    const s = await shopper(ali);
    await s.add(a!, 30);
    await s.apply('BLOGER10');
    expect(await placeOrder(s)).toMatchObject({
      discount: { type: 'promo_code', code: 'BLOGER10', amount: 14_900 },
      total: 159_100,
    });

    const late = await shopper(vali, '998901112233');
    await late.add(b!, 30);
    await late.apply('BLOGER10');
    const body = await orderBody(late); // confirmed with the code, a second before midnight
    expect(body.confirmedTotal).toBe(159_100);
    t.edges.clock.set(new Date('2026-11-15T19:00:00Z'));
    expect(await late.client.orders.create({ body })).toMatchObject({
      status: 409,
      body: {
        code: 'total_changed',
        checkout: {
          quote: { discount: null, total: 174_000, promoCode: { invalid: { reason: 'expired' } } },
        },
      },
    });
    expect(await usesOf()).toMatchObject({ uses: 1, state: 'expired' });
  });

  it('a code lost between the quote and the order is 409 even when the total comes out the same', async () => {
    const [a, b] = await slugs(2);
    await setPrice(a!, 50, 260_000);
    await createPromo({
      code: 'MINUS25',
      kind: 'fixed',
      percent: null,
      amount: 25_000,
      totalLimit: 1,
    });
    const late = await shopper(vali, '998901112233');
    await late.add(a!, 50);
    await late.apply('MINUS25');
    // with the code: 260 000 − 25 000 = 235 000 is below the threshold (base «after»), + 25 000
    const stale = await orderBody(late);
    expect(stale).toMatchObject({
      confirmedTotal: 260_000,
      confirmedDiscount: { type: 'promo_code', code: 'MINUS25', amount: 25_000 },
    });

    const first = await shopper(ali);
    await first.add(b!, 30);
    await first.apply('MINUS25');
    await placeOrder(first);

    // without it: 260 000 ships free, the same 260 000, but not the order the shopper confirmed
    const res = await late.client.orders.create({ body: stale });
    expect(res).toMatchObject({
      status: 409,
      body: {
        code: 'total_changed',
        checkout: {
          quote: {
            discount: null,
            deliveryFee: 0,
            total: 260_000,
            promoCode: { code: 'MINUS25', invalid: { reason: 'exhausted' } },
          },
        },
      },
    });
    expect(await usesOf('MINUS25')).toMatchObject({ uses: 1 });
    // confirming the new terms orders without the code
    const again = await late.client.orders.create({
      body: { ...stale, confirmedDiscount: null, idempotencyKey: randomUUID() },
    });
    expect(again).toMatchObject({ status: 201, body: { discount: null, total: 260_000 } });
  });

  it('a code exhausted between the quote and the order: 409 with the new quote, which says why', async () => {
    const [a, b] = await slugs(2);
    await createPromo({ totalLimit: 1 });
    const late = await shopper(vali, '998901112233');
    await late.add(b!, 30);
    await late.apply('BLOGER10');
    const stale = await orderBody(late); // confirmed at 149 000 − 14 900 + 25 000
    expect(stale.confirmedTotal).toBe(159_100);

    const first = await shopper(ali);
    await first.add(a!, 30);
    await first.apply('BLOGER10');
    await placeOrder(first);

    const res = await late.client.orders.create({ body: stale });
    expect(res).toMatchObject({
      status: 409,
      body: {
        code: 'total_changed',
        checkout: {
          quote: {
            discount: null,
            total: 174_000,
            promoCode: { code: 'BLOGER10', invalid: { reason: 'exhausted' } },
          },
        },
      },
    });
    expect(await usesOf()).toMatchObject({ uses: 1 });
    // never blocked: confirming the new total orders without the code
    const again = await late.client.orders.create({
      body: {
        ...stale,
        confirmedTotal: 174_000,
        confirmedDiscount: null,
        idempotencyKey: randomUUID(),
      },
    });
    expect(again).toMatchObject({ status: 201, body: { discount: null, total: 174_000 } });
  });

  it('a used code can be switched off but not deleted', async () => {
    const [a] = await slugs(1);
    const created = await createPromo();
    const s = await shopper();
    await s.add(a!, 30);
    await s.apply('BLOGER10');
    const order = await placeOrder(s);
    await cancel(s, order.number);
    const res = await owner.client.admin.promoCodes.remove({ params: { id: created.id } });
    expect(res).toMatchObject({ status: 409, body: { code: 'in_use' } });
  });
});

describe('typing codes: guessable, so attempts are limited (settings)', () => {
  it('past promo.attemptLimit codes in the window: 429, the stored code stays; the window ends, typing works again', async () => {
    for (const [key, value] of [
      ['promo.attemptLimit', 2],
      ['promo.attemptWindowSeconds', 600],
    ] as const) {
      const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
      expect(res.status).toBe(200);
    }
    await createPromo();
    const s = await shopper();
    expect((await s.apply('GUESS1')).promoCode).toBe('GUESS1');
    t.edges.clock.advance(60_000);
    expect((await s.apply('bloger10')).promoCode).toBe('BLOGER10');

    // a third code within 600 s of the first is refused and the stored one stays
    const refused = await s.client.cart.applyPromoCode({ body: { code: 'GUESS2' } });
    expect(refused).toMatchObject({
      status: 429,
      body: { code: 'too_many_attempts', retryAfterSeconds: 540 },
    });
    expect((await s.client.cart.get()).body).toMatchObject({ promoCode: 'BLOGER10' });
    // removing is not an attempt, and works while typing is refused
    const removed = await s.client.cart.removePromoCode();
    expect(removed.status === 200 && removed.body.promoCode).toBeNull();
    t.edges.clock.advance(539_000);
    expect((await s.client.cart.applyPromoCode({ body: { code: 'GUESS2' } })).status).toBe(429);
    t.edges.clock.advance(1_000);
    expect((await s.apply('GUESS2')).promoCode).toBe('GUESS2');
  });
});
