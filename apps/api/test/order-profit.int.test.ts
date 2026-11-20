import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OrderProfit, PromoCodeInput } from '@lummi/contracts';
import { and, eq, fragrances, orderLines, orders, volumes } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { freezeMissingOrderCosts } from '../src/cost/freeze-order-costs';
import { fulfilTo, orderRow, pay, placeOrder, tashkent } from './harness/fulfilment';
import { shopper, slugs } from './harness/orders';
import type { TestUser } from './harness/sign-init-data';
import { giftSampleOff } from './harness/gift-sample';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): order profit (#77). The payment's confirmation freezes the order's costs; the
 * owner reads them on the order page and in the sales report. Every expected figure is the
 * customer's calculator's own (its order screen, `orderCosts` over `unit`) for the made-up oil
 * prices below at its default settings, rounded to whole so'm as it shows them. Prices are the
 * calculator's: 10 ml 69 000, 30 ml 189 000, 50 ml 249 000; delivery 25 000 below 250 000.
 */
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

/** Made-up oil prices, so'm per gram before the supplier discount (the unit table's A and B). */
const OIL_A = 3950;
const OIL_B = 2150;
const PRICES: Record<number, number> = { 10: 69_000, 30: 189_000, 50: 249_000 };

const ali: TestUser = { id: 7701, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 7702, first_name: 'Vali', language_code: 'uz' };

let t: TestApp;
let owner: StaffSession;
/** A and B carry oil prices; C has none. */
let A: { slug: string; id: number; name: string };
let B: { slug: string; id: number; name: string };
let C: { slug: string; id: number; name: string };

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(tashkent('2026-11-19 10:00'));
  await t.reset();
  await t.seedCatalog();
  // the seed's concentrate would give each first order a 5 ml sample; not what these tests are about
  await giftSampleOff(t);
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  const picked = [];
  for (const slug of await slugs(t, 3)) {
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, slug));
    for (const ml of [10, 30, 50])
      await t.db
        .update(volumes)
        .set({ price: PRICES[ml]!, salePrice: null, saleEndsAt: null })
        .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, ml)));
    picked.push({ slug, id: f!.id, name: f!.name });
  }
  [A, B, C] = picked as [typeof A, typeof B, typeof C];
  await t.db.update(fragrances).set({ oilPrice: OIL_A }).where(eq(fragrances.id, A.id));
  await t.db.update(fragrances).set({ oilPrice: OIL_B }).where(eq(fragrances.id, B.id));
  await t.db.update(fragrances).set({ oilPrice: null }).where(eq(fragrances.id, C.id));
});

type Line = { slug: string; ml: 10 | 30 | 50; qty?: number };

/** A shopper's order of `lines` (and a code), placed and paid at the clock's now. */
async function paidOrder(lines: Line[], opts: { user?: TestUser; code?: string } = {}) {
  const user = opts.user ?? ali;
  const client = await shopper(t, user, `99890${String(user.id).padStart(7, '0')}`);
  for (const l of lines)
    await client.cart.addLine({ body: { slug: l.slug, ml: l.ml, qty: l.qty ?? 1 } });
  if (opts.code) {
    const res = await client.cart.applyPromoCode({ body: { code: opts.code } });
    if (res.status !== 200) throw new Error(`code: ${res.status}`);
  }
  const order = await placeOrder(t, client);
  await pay(t, order.number);
  return orderRow(t, order.number);
}

async function costsOf(number: number, who: StaffSession = owner) {
  const res = await who.client.admin.orders.costs({ params: { number } });
  return res;
}

async function unitCosts(orderId: number) {
  const rows = await t.db
    .select({ position: orderLines.position, unitCost: orderLines.unitCost })
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId))
    .orderBy(orderLines.position);
  return rows.map((r) => r.unitCost);
}

const DEFAULTS = {
  channel: 'miniapp',
  mailer: 2000,
  btsCharge: 25_000,
  commissionPercent: 0,
  commission: 0,
  adPerSale: 3000,
  taxPercent: 1,
  giftSample: 0,
} as const satisfies Partial<OrderProfit>;

describe("an order's profit, frozen when its payment is confirmed", () => {
  it('Mini App below free delivery: the customer paid the 25 000, so BTS costs the shop nothing more', async () => {
    const o = await paidOrder([{ slug: A.slug, ml: 30 }]);
    expect(o.deliveryFee).toBe(25_000);
    expect(o.costs).toEqual({
      at: expect.any(String),
      missing: [],
      profit: {
        ...DEFAULTS,
        revenue: 189_000,
        goods: 52_086,
        deliveryPaid: 25_000,
        tax: 1890,
        cost: 58_976,
        // the calculator: «Все ароматы», 30 мл, Мини-апп
        profit: 130_024,
        margin: 130_024 / 189_000,
      },
    });
    expect(await unitCosts(o.id)).toEqual([52_086]);
  });

  it('from the free-delivery threshold: the shop pays BTS', async () => {
    const o = await paidOrder([
      { slug: A.slug, ml: 50 },
      { slug: A.slug, ml: 10 },
    ]);
    expect(o.deliveryFee).toBe(0);
    expect(o.costs!.profit).toMatchObject({
      revenue: 318_000,
      goods: 78_651 + 22_462,
      deliveryPaid: 0,
      btsCharge: 25_000,
      tax: 3180,
      cost: 134_293,
      profit: 183_707,
    });
    expect(await unitCosts(o.id)).toEqual([78_651, 22_462]);
  });

  it("a promo gift's line is goods at its unit cost; the revenue is what was paid", async () => {
    const gift: PromoCodeInput = {
      code: 'GIFT10',
      kind: 'gift',
      percent: null,
      amount: null,
      maxDiscount: null,
      promoGift: { kind: 'volume', fragranceId: B.id, ml: 10 },
      expiresOn: null,
      minOrderTotal: null,
      totalLimit: null,
      perCustomerLimit: null,
      newCustomersOnly: false,
      appliesToMarkedDown: false,
      active: true,
    };
    expect((await owner.client.admin.promoCodes.create({ body: gift })).status).toBe(201);
    const o = await paidOrder([{ slug: A.slug, ml: 30 }], { code: 'GIFT10' });
    expect(await unitCosts(o.id)).toEqual([52_086, 17_145]);
    expect(o.costs!.profit).toMatchObject({
      revenue: 189_000,
      goods: 52_086 + 17_145,
      deliveryPaid: 25_000,
      tax: 1890,
      cost: 76_121,
      profit: 112_879,
    });
  });

  it('no oil price, no cost: the order has no profit and names the fragrance', async () => {
    const o = await paidOrder([
      { slug: A.slug, ml: 10 },
      { slug: C.slug, ml: 10 },
    ]);
    expect(o.costs).toMatchObject({ profit: null, missing: [C.name] });
    expect(await unitCosts(o.id)).toEqual([22_462, null]);
  });

  it("doesn't move when a setting or an oil price changes; the next order takes the new ones", async () => {
    const first = await paidOrder([{ slug: A.slug, ml: 30 }]);
    const before = await costsOf(first.number);
    expect(before.status).toBe(200);

    for (const [key, value] of [
      ['cost.order.adPerSale', 5000],
      ['cost.order.taxPercent', 2],
      ['cost.liquid.oilDiscountPercent', 0],
      ['cost.packaging.box30Ml', 9000],
    ] as const) {
      const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
      expect(res.status).toBe(200);
    }
    await t.db.update(fragrances).set({ oilPrice: 9150 }).where(eq(fragrances.id, A.id));
    // the order moving on changes nothing either
    await fulfilTo(t, first.number, 'delivered');

    const after = await costsOf(first.number);
    expect(after.body).toEqual(before.body);
    expect(after.status === 200 && after.body.snapshot?.profit?.profit).toBe(130_024);

    const next = await paidOrder([{ slug: A.slug, ml: 30 }], { user: vali });
    expect(next.costs!.profit).toMatchObject({ adPerSale: 5000, taxPercent: 2, tax: 3780 });
    expect((await unitCosts(next.id))[0]).not.toBe(52_086);
  });
});

describe("the order page's profit block", () => {
  it("is the owner's: lines with their unit costs and the snapshot; a manager gets 403", async () => {
    const o = await paidOrder([{ slug: A.slug, ml: 10, qty: 2 }]);
    const res = await costsOf(o.number);
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body.lines).toEqual([
      { position: 0, unitCost: 22_462, cost: 44_924 },
    ]);
    expect((await costsOf(o.number, await t.managerSession())).status).toBe(403);
    expect((await costsOf(999_999)).status).toBe(404);
  });

  it('shows no snapshot before the payment is confirmed', async () => {
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addLine({ body: { slug: A.slug, ml: 10, qty: 1 } });
    const o = await placeOrder(t, client);
    const res = await costsOf(o.number);
    expect(res.status === 200 && res.body).toEqual({
      snapshot: null,
      lines: [{ position: 0, unitCost: null, cost: null }],
    });
  });
});

describe('orders paid before costs were recorded', () => {
  const backfill = () => freezeMissingOrderCosts(t.db, t.edges.clock.now());

  it('get theirs frozen once, on deploy, with the prices and settings of then', async () => {
    const o = await paidOrder([{ slug: A.slug, ml: 30 }]);
    // as an order paid before #77 reads: no snapshot, no unit costs
    await t.db.update(orders).set({ costs: null }).where(eq(orders.id, o.id));
    await t.db.update(orderLines).set({ unitCost: null }).where(eq(orderLines.orderId, o.id));
    // an unpaid order is left alone
    const client = await shopper(t, vali, '998907654321');
    await client.cart.addLine({ body: { slug: A.slug, ml: 10, qty: 1 } });
    const unpaid = await placeOrder(t, client);

    expect(await backfill()).toEqual({ frozen: 1, waiting: 0, uncostable: [] });
    expect((await orderRow(t, o.number)).costs?.profit?.profit).toBe(130_024);
    expect(await unitCosts(o.id)).toEqual([52_086]);
    expect((await orderRow(t, unpaid.number)).costs).toBeNull();
    expect(await backfill()).toEqual({ frozen: 0, waiting: 0, uncostable: [] });
  });

  it('wait for a missing oil price instead of freezing without costs for good', async () => {
    const o = await paidOrder([{ slug: C.slug, ml: 10 }]);
    await t.db.update(orders).set({ costs: null }).where(eq(orders.id, o.id));
    expect(await backfill()).toEqual({ frozen: 0, waiting: 1, uncostable: [] });
    expect((await orderRow(t, o.number)).costs).toBeNull();
    // the owner types C's oil price (B's, made up): the next deploy freezes it
    await t.db.update(fragrances).set({ oilPrice: OIL_B }).where(eq(fragrances.id, C.id));
    expect(await backfill()).toEqual({ frozen: 1, waiting: 0, uncostable: [] });
    expect(await unitCosts(o.id)).toEqual([17_145]);
  });

  it('freeze an order with a line that has nothing to cost once, without a profit, and name it', async () => {
    const o = await paidOrder([{ slug: A.slug, ml: 10 }]);
    await t.db.update(orders).set({ costs: null }).where(eq(orders.id, o.id));
    // a volume line without its fragrance: no unit cost can ever come
    await t.db.update(orderLines).set({ fragranceId: null }).where(eq(orderLines.orderId, o.id));
    expect(await backfill()).toEqual({ frozen: 0, waiting: 0, uncostable: [o.number] });
    expect((await orderRow(t, o.number)).costs).toMatchObject({ profit: null, missing: [] });
    // never retried
    expect(await backfill()).toEqual({ frozen: 0, waiting: 0, uncostable: [] });
  });
});

describe('the sales report: revenue, cost, profit and margin', () => {
  it('totals equal the sum of their orders; the rows add up to the total profit', async () => {
    const gift: PromoCodeInput = {
      code: 'GIFTB',
      kind: 'gift',
      percent: null,
      amount: null,
      maxDiscount: null,
      promoGift: { kind: 'volume', fragranceId: B.id, ml: 10 },
      expiresOn: null,
      minOrderTotal: null,
      totalLimit: null,
      perCustomerLimit: null,
      newCustomersOnly: false,
      appliesToMarkedDown: false,
      active: true,
    };
    expect((await owner.client.admin.promoCodes.create({ body: gift })).status).toBe(201);
    const users: TestUser[] = [7711, 7712, 7713, 7714].map((id) => ({
      id,
      first_name: `U${id}`,
      language_code: 'ru',
    }));
    const placed = [
      await paidOrder([{ slug: A.slug, ml: 30 }], { user: users[0] }),
      await paidOrder(
        [
          { slug: A.slug, ml: 50 },
          { slug: B.slug, ml: 10, qty: 2 },
        ],
        { user: users[1] },
      ),
      await paidOrder([{ slug: A.slug, ml: 10 }], { user: users[2], code: 'GIFTB' }),
      // C has no oil price: the order is uncosted
      await paidOrder([{ slug: C.slug, ml: 30 }], { user: users[3] }),
    ];
    for (const o of placed) await fulfilTo(t, o.number, 'delivered');
    const costed = (await Promise.all(placed.map((o) => orderRow(t, o.number))))
      .map((o) => o.costs?.profit)
      .filter((c): c is OrderProfit => !!c);
    expect(costed).toHaveLength(3);

    const res = await owner.client.admin.reports.sales({
      query: { from: '2026-11-19', to: '2026-11-19' },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const sum = (f: (c: OrderProfit) => number) => costed.reduce((s, c) => s + f(c), 0);
    const revenue = sum((c) => c.revenue);
    const profit = sum((c) => c.profit);
    expect(res.body.profit).toEqual({
      orders: 3,
      uncosted: 1,
      revenue,
      cost: sum((c) => c.cost),
      profit,
      margin: profit / revenue,
    });

    const rows = [...res.body.fragrances, ...res.body.sets];
    const byId = new Map(res.body.fragrances.map((r) => [r.fragranceId, r]));
    expect(byId.get(C.id)).toMatchObject({ cost: null, profit: null });
    // B's gift line: goods at unit cost, no revenue
    expect(byId.get(B.id)!.profit).not.toBeNull();
    const rowProfit = rows.reduce((s, r) => s + (r.profit ?? 0), 0);
    expect(rowProfit).toBe(profit);
    for (const r of rows.filter((x) => x.profit !== null)) expect(r.net - r.cost!).toBe(r.profit);
    const volumeProfit = res.body.volumes.reduce((s, r) => s + (r.profit ?? 0), 0);
    expect(volumeProfit).toBe(profit);
  });
});
