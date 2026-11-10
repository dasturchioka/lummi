import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody, PromoCodeInput } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import { and, auditLog, btsPoints, eq, fragrances, regions, volumes } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
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

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };
const HOUR = 3600_000;

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
  if (res.status !== 201) throw new Error(`create promo: ${res.status} ${JSON.stringify(res.body)}`);
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
    expect((await post(promo({ code: 'MINUS20', kind: 'fixed', percent: null, amount: 20_000 }))).status).toBe(201);
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
    expect(res).toMatchObject({ status: 200, body: { percent: 15, active: false, state: 'inactive' } });
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
    expect(await quoteOf(s)).toMatchObject({ discount: { amount: 21_900 }, promoCode: { invalid: null } });
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
    expect(await quoteOf(s)).toMatchObject({ discount: { amount: 26_900 }, total: 242_100 + 25_000 });
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
