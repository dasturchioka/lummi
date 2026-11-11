import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody } from '@lummi/contracts';
import {
  and,
  birthdayCoupons,
  eq,
  fragrances,
  orders,
  upgradeRights,
  volumes,
} from '@lummi/db';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import {
  samarkandPoint,
  shopper,
  slugs as slugsOf,
  untilWaitingOnLocks,
} from './harness/orders';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the discount choice in the cart (#39, ADR 0002). One Discount per order; with
 * no entered code the server picks the one giving the lowest total including delivery, an entered
 * code stays applied, and the shopper can switch between them or apply none («Не применять»).
 *
 * Seed prices: 10 ml 69 000, 30 ml 149 000, 50 ml 219 000. Delivery 25 000 below 250 000; the
 * threshold is counted before an upgrade right and after a promo code or a birthday coupon.
 */

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  // 15:00 in Tashkent on 11 November
  t.edges.clock.set(new Date('2026-11-11T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 91, first_name: 'Ali', language_code: 'ru' };

type Client = Awaited<ReturnType<typeof shopper>>;

const IN_10_DAYS = new Date('2026-11-21T19:00:00Z'); // 00:00 Tashkent on 22 November
const IN_20_DAYS = new Date('2026-12-01T19:00:00Z'); // 00:00 Tashkent on 2 December

async function customerIdOf(c: Client) {
  const me = await c.me.get();
  if (me.status !== 200) throw new Error(`me: ${me.status}`);
  return me.body.id;
}

async function add(c: Client, slug: string, ml: 10 | 30 | 50) {
  const res = await c.cart.addLine({ body: { slug, ml, qty: 1 } });
  if (res.status !== 200) throw new Error(`add ${slug}: ${res.status}`);
  return res.body;
}

async function cartOf(c: Client) {
  const res = await c.cart.get();
  if (res.status !== 200) throw new Error(`cart ${res.status}`);
  return res.body;
}

/** A birthday coupon as the job issues it (terms fixed at issue). */
async function coupon(customerId: number, percent: number, expiresAt = IN_10_DAYS) {
  const [row] = await t.db
    .insert(birthdayCoupons)
    .values({
      customerId,
      birthdayYear: 2026,
      birthday: '2026-11-14',
      percent,
      maxAmount: 100_000,
      issuedAt: new Date('2026-11-11T05:00:00Z'),
      expiresAt,
    })
    .returning();
  return row!;
}

/**
 * An upgrade right on `slug` as «Доставлен» opens it (ADR 0003): a delivered order is its source,
 * here a «Купить сейчас» 10 ml bottle the shopper ordered (the cart stays as it was).
 */
async function right(
  c: Client,
  customerId: number,
  slug: string,
  o: { source?: 'set' | 'single_10ml'; expiresAt?: Date } = {},
) {
  const res = await c.orders.create({ body: await orderBody(c, `volume:${slug}:10`) });
  if (res.status !== 201) throw new Error(`source order ${res.status}`);
  const [source] = await t.db.select().from(orders).where(eq(orders.number, res.body.number));
  const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, slug));
  const [row] = await t.db
    .insert(upgradeRights)
    .values({
      customerId,
      source: o.source ?? 'set',
      sourceOrderId: source!.id,
      sourcePosition: 0,
      sourceUnit: 0,
      fragrances: [{ fragranceId: f!.id, name: f!.name, brand: f!.originalBrand }],
      percent: 20,
      openedAt: t.edges.clock.now(),
      expiresAt: o.expiresAt ?? IN_20_DAYS,
    })
    .returning();
  return row!;
}

/** The coupon's window closes now (its last day has passed; the session would not last 10 days). */
async function endNow(couponId: number) {
  await t.db
    .update(birthdayCoupons)
    .set({ expiresAt: t.edges.clock.now() })
    .where(eq(birthdayCoupons.id, couponId));
}

/** The checkout body for the cart (or a buy-now `item`) as quoted now, to a Samarkand point. */
async function orderBody(c: Client, item?: string): Promise<CreateOrderBody> {
  const point = await samarkandPoint(t);
  const checkout = await c.checkout.get({ query: { regionId: point.regionId, item } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  return {
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998901234567',
    delivery: { kind: 'point', pointId: point.id },
    consent: true,
    confirmedTotal: checkout.body.quote.total,
    confirmedDiscount: checkout.body.quote.discount,
    idempotencyKey: crypto.randomUUID(),
    ...(item ? { item } : {}),
  };
}

async function promo(code: string, percent: number) {
  const owner = await t.ownerSession();
  const res = await owner.client.admin.promoCodes.create({
    body: {
      code,
      kind: 'percent',
      percent,
      amount: null,
      maxDiscount: null,
      expiresOn: null,
      minOrderTotal: null,
      totalLimit: null,
      perCustomerLimit: null,
      newCustomersOnly: false,
      appliesToMarkedDown: false,
      active: true,
    },
  });
  if (res.status !== 201) throw new Error(`promo ${res.status}`);
}

/**
 * Ali's cart of 287 000: X 30 ml, Y and Z 10 ml. His set right on X takes 20 % of 149 000 =
 * 29 800 and, counted before the discount, keeps delivery free: 257 200. His 15 % birthday coupon
 * takes 43 050 of the items but, counted after it, leaves 243 950 under the threshold: 268 950.
 */
async function aliWithTwoEntitlements() {
  const c = await shopper(t, ali, '998901112233');
  const id = await customerIdOf(c);
  const [x, y, z] = await slugsOf(t, 3);
  const r = await right(c, id, x!);
  const b = await coupon(id, 15);
  await add(c, x!, 30);
  await add(c, y!, 10);
  await add(c, z!, 10);
  return { c, id, right: r, coupon: b, slugs: [x!, y!, z!] };
}

describe('the automatic choice', () => {
  it('picks the lowest total including delivery, not the larger discount, and lists every option with its total', async () => {
    const { c, right: r, coupon: b } = await aliWithTwoEntitlements();
    const cart = await cartOf(c);
    expect(cart.quote).toMatchObject({
      itemsSubtotal: 287_000,
      discount: { type: 'upgrade_right', id: r.id, amount: 29_800 },
      deliveryFee: 0,
      total: 257_200,
      alternatives: [
        { discount: { type: 'birthday_coupon', id: b.id, amount: 43_050 }, total: 268_950 },
      ],
      withoutDiscount: { deliveryFee: 0, total: 287_000 },
      staleChoice: false,
    });
    // the switch: cheapest first, «Не применять» last, the applied one marked, each with its terms
    expect(cart.discountOptions).toEqual([
      {
        discount: expect.objectContaining({ type: 'upgrade_right', id: r.id }),
        deliveryFee: 0,
        total: 257_200,
        applied: true,
        terms: { percent: 20, lastDay: '2026-12-01' },
      },
      {
        discount: expect.objectContaining({ type: 'birthday_coupon', id: b.id }),
        deliveryFee: 25_000,
        total: 268_950,
        applied: false,
        terms: { percent: 15, lastDay: '2026-11-21' },
      },
      { discount: null, deliveryFee: 0, total: 287_000, applied: false, terms: null },
    ]);
  });

  it('offers no switch when nothing but an entered code could discount the cart', async () => {
    const c = await shopper(t, ali, '998901112233');
    const [x] = await slugsOf(t, 1);
    await promo('BLOGER5', 5);
    await add(c, x!, 50);
    expect((await cartOf(c)).discountOptions).toEqual([]);
    const res = await c.cart.applyPromoCode({ body: { code: 'BLOGER5' } });
    expect(res).toMatchObject({
      status: 200,
      body: { quote: { discount: { type: 'promo_code' } }, discountOptions: [] },
    });
  });
});

describe('an entered promo code', () => {
  it('stays applied when an entitlement is cheaper; the hint names the cheapest one and by how much', async () => {
    const { c, right: r, coupon: b } = await aliWithTwoEntitlements();
    await promo('BLOGER5', 5);
    // 5 % of 287 000 = 14 350, counted after: 272 650, delivery free
    const res = await c.cart.applyPromoCode({ body: { code: 'bloger5' } });
    expect(res.status).toBe(200);
    const cart = await cartOf(c);
    expect(cart.quote).toMatchObject({
      discount: { type: 'promo_code', code: 'BLOGER5', amount: 14_350 },
      total: 272_650,
    });
    // the set right is 15 450 cheaper (257 200), the coupon 3 700 (268 950): the hint takes the right
    expect(cart.entitlementWaiting).toEqual({
      type: 'upgrade_right',
      id: r.id,
      source: 'set',
      percent: 20,
      lastDay: '2026-12-01',
      cheaperBy: 15_450,
    });
    expect(cart.discountOptions.map((o) => [o.discount?.type ?? null, o.total, o.applied])).toEqual(
      [
        ['upgrade_right', 257_200, false],
        ['birthday_coupon', 268_950, false],
        ['promo_code', 272_650, true],
        [null, 287_000, false],
      ],
    );
    expect(cart.discountOptions[1]!.discount).toMatchObject({ id: b.id });
  });

  it('the hint is worded by source: a 10 ml bottle’s right, or the birthday coupon', async () => {
    const c = await shopper(t, ali, '998901112233');
    const id = await customerIdOf(c);
    const [x, y, z] = await slugsOf(t, 3);
    await promo('BLOGER5', 5);
    const r = await right(c, id, x!, { source: 'single_10ml' });
    await add(c, x!, 30);
    await add(c, y!, 10);
    await add(c, z!, 10);
    await c.cart.applyPromoCode({ body: { code: 'BLOGER5' } });
    expect((await cartOf(c)).entitlementWaiting).toMatchObject({
      type: 'upgrade_right',
      id: r.id,
      source: 'single_10ml',
      cheaperBy: 15_450,
    });

    // the right used up elsewhere, a 20 % coupon: 57 400 off, 229 600 + 25 000 = 254 600
    await t.db.update(upgradeRights).set({ closedAt: t.edges.clock.now() });
    const b = await coupon(id, 20);
    expect((await cartOf(c)).entitlementWaiting).toEqual({
      type: 'birthday_coupon',
      id: b.id,
      percent: 20,
      lastDay: '2026-11-21',
      cheaperBy: 18_050,
    });
  });

  it('an entitlement that is not cheaper still waits, with nothing to gain', async () => {
    const c = await shopper(t, ali, '998901112233');
    const id = await customerIdOf(c);
    const [x] = await slugsOf(t, 1);
    await promo('BLOGER30', 30);
    const b = await coupon(id, 10);
    await add(c, x!, 50);
    await c.cart.applyPromoCode({ body: { code: 'BLOGER30' } });
    expect((await cartOf(c)).entitlementWaiting).toMatchObject({ id: b.id, cheaperBy: 0 });
  });
});

describe('the switch', () => {
  it('one tap moves from the entered code to the entitlement and back; the code is remembered', async () => {
    const { c, right: r } = await aliWithTwoEntitlements();
    await promo('BLOGER5', 5);
    await c.cart.applyPromoCode({ body: { code: 'BLOGER5' } });

    const toRight = await c.cart.chooseDiscount({ body: { type: 'upgrade_right', id: r.id } });
    expect(toRight).toMatchObject({
      status: 200,
      body: {
        // the code stays in the cart, not applied, and offered with its total
        promoCode: 'BLOGER5',
        quote: {
          discount: { type: 'upgrade_right', id: r.id },
          total: 257_200,
          promoCode: { code: 'BLOGER5', invalid: null },
          staleChoice: false,
        },
        entitlementWaiting: null,
      },
    });
    if (toRight.status !== 200) return;
    expect(
      toRight.body.discountOptions.find((o) => o.discount?.type === 'promo_code'),
    ).toMatchObject({ total: 272_650, applied: false });
    // every later quote keeps it
    await add(c, (await slugsOf(t, 4))[3]!, 10);
    expect((await cartOf(c)).quote.discount).toMatchObject({ type: 'upgrade_right', id: r.id });

    const back = await c.cart.chooseDiscount({ body: { type: 'promo_code' } });
    expect(back).toMatchObject({
      status: 200,
      body: { quote: { discount: { type: 'promo_code', code: 'BLOGER5' } } },
    });
  });

  it('the shopper may pick a costlier entitlement; it stays until changed', async () => {
    const { c, coupon: b } = await aliWithTwoEntitlements();
    const res = await c.cart.chooseDiscount({ body: { type: 'birthday_coupon', id: b.id } });
    expect(res).toMatchObject({
      status: 200,
      body: { quote: { discount: { type: 'birthday_coupon', id: b.id }, total: 268_950 } },
    });
    expect((await cartOf(c)).quote).toMatchObject({
      discount: { type: 'birthday_coupon', id: b.id },
      staleChoice: false,
    });
  });

  it('refuses what the cart does not offer, and answers with the cart as it is', async () => {
    const { c, right: r } = await aliWithTwoEntitlements();
    const notHeld = await c.cart.chooseDiscount({ body: { type: 'birthday_coupon', id: 9999 } });
    expect(notHeld).toMatchObject({
      status: 409,
      body: {
        code: 'discount_unavailable',
        cart: { quote: { discount: { type: 'upgrade_right', id: r.id } } },
      },
    });
    // no code entered: there is no code to switch to
    const noCode = await c.cart.chooseDiscount({ body: { type: 'promo_code' } });
    expect(noCode).toMatchObject({ status: 409, body: { code: 'discount_unavailable' } });
    expect((await cartOf(c)).quote).toMatchObject({
      discount: { type: 'upgrade_right', id: r.id },
      staleChoice: false,
    });
  });

  it('typing a new code makes it the applied discount again (ADR 0002)', async () => {
    const { c, right: r } = await aliWithTwoEntitlements();
    await promo('BLOGER5', 5);
    await promo('LUMMI7', 7);
    await c.cart.applyPromoCode({ body: { code: 'BLOGER5' } });
    await c.cart.chooseDiscount({ body: { type: 'upgrade_right', id: r.id } });
    await c.cart.applyPromoCode({ body: { code: 'LUMMI7' } });
    expect((await cartOf(c)).quote.discount).toMatchObject({ type: 'promo_code', code: 'LUMMI7' });
  });
});

describe('«Не применять»', () => {
  /** Ali with a 20 % coupon and a 50 ml: 43 800 off, after base, 175 200 + 25 000 = 200 200. */
  async function aliWithCoupon() {
    const c = await shopper(t, ali, '998901112233');
    const id = await customerIdOf(c);
    const b = await coupon(id, 20);
    const [x, y] = await slugsOf(t, 2);
    await add(c, x!, 50);
    return { c, id, coupon: b, slugs: [x!, y!] };
  }

  it('applies no discount and keeps the coupon through the order; the next cart gets it back by itself', async () => {
    const { c, coupon: b, slugs } = await aliWithCoupon();
    expect((await cartOf(c)).quote).toMatchObject({ discount: { id: b.id }, total: 200_200 });

    const res = await c.cart.chooseDiscount({ body: { type: 'none' } });
    expect(res).toMatchObject({
      status: 200,
      body: {
        quote: {
          discount: null,
          total: 244_000,
          alternatives: [{ discount: { type: 'birthday_coupon', id: b.id }, total: 200_200 }],
          staleChoice: false,
        },
      },
    });
    if (res.status !== 200) return;
    expect(res.body.discountOptions.map((o) => [o.discount?.type ?? null, o.applied])).toEqual([
      ['birthday_coupon', false],
      [null, true],
    ]);

    // it survives every quote while the cart changes
    await add(c, slugs[1]!, 10);
    expect((await cartOf(c)).quote).toMatchObject({ discount: null, total: 288_000 });

    const body = await orderBody(c);
    expect(body).toMatchObject({ confirmedDiscount: null, confirmedTotal: 288_000 });
    const order = await c.orders.create({ body });
    expect(order).toMatchObject({ status: 201, body: { discount: null, total: 288_000 } });
    // the coupon is still the customer's
    expect((await c.me.discounts()).body).toMatchObject({ birthdayCoupons: [{ id: b.id }] });
    expect((await t.db.select().from(birthdayCoupons))[0]!.usedByOrderId).toBeNull();

    // the order took the choice with its lines: the next cart picks by itself again
    await add(c, slugs[0]!, 50);
    expect((await cartOf(c)).quote).toMatchObject({
      discount: { type: 'birthday_coupon', id: b.id },
      staleChoice: false,
    });
  });

  it('lasts until the cart is emptied', async () => {
    const { c, coupon: b, slugs } = await aliWithCoupon();
    await c.cart.chooseDiscount({ body: { type: 'none' } });
    const [line] = (await cartOf(c)).lines;
    await c.cart.removeLine({ params: { lineId: line!.id } });
    await add(c, slugs[0]!, 50);
    expect((await cartOf(c)).quote.discount).toMatchObject({ type: 'birthday_coupon', id: b.id });
  });

  it('removing the entered code keeps it; only typing a code replaces it', async () => {
    const { c, coupon: b } = await aliWithCoupon();
    await promo('BLOGER5', 5);
    await c.cart.applyPromoCode({ body: { code: 'BLOGER5' } });
    const none = await c.cart.chooseDiscount({ body: { type: 'none' } });
    expect(none).toMatchObject({
      status: 200,
      body: {
        promoCode: 'BLOGER5',
        quote: { discount: null, promoCode: { code: 'BLOGER5', invalid: null } },
      },
    });
    const removed = await c.cart.removePromoCode();
    expect(removed).toMatchObject({
      status: 200,
      body: { promoCode: null, quote: { discount: null } },
    });
    // typing a code ends it: the code wins again (ADR 0002), 5 % of 219 000 = 10 950, counted
    // after it: 208 050 + 25 000. The coupon (200 200) is 32 850 cheaper and says so.
    const typed = await c.cart.applyPromoCode({ body: { code: 'BLOGER5' } });
    expect(typed).toMatchObject({
      status: 200,
      body: {
        quote: {
          discount: { type: 'promo_code', code: 'BLOGER5', amount: 10_950 },
          deliveryFee: 25_000,
          total: 233_050,
          staleChoice: false,
        },
        entitlementWaiting: { type: 'birthday_coupon', id: b.id, cheaperBy: 32_850 },
      },
    });
  });

  it('with nothing to decline it is not remembered: a coupon that comes later applies by itself', async () => {
    const c = await shopper(t, ali, '998901112233');
    const id = await customerIdOf(c);
    const [x] = await slugsOf(t, 1);
    await add(c, x!, 50);
    expect(await c.cart.chooseDiscount({ body: { type: 'none' } })).toMatchObject({ status: 200 });
    const b = await coupon(id, 20);
    expect((await cartOf(c)).quote.discount).toMatchObject({ type: 'birthday_coupon', id: b.id });
  });

  it('ends without a notice once the declined coupon has ended: a right that comes later applies by itself', async () => {
    const { c, id, coupon: b, slugs } = await aliWithCoupon();
    await c.cart.chooseDiscount({ body: { type: 'none' } });
    await endNow(b.id);
    // nothing is left to decline: no discount either way, and nothing stale to report
    const cart = await cartOf(c);
    expect(cart.quote).toMatchObject({ discount: null, total: 244_000, staleChoice: false });
    expect(cart.discountOptions).toEqual([]);

    // 20 % of 219 000 = 43 800, counted before it: 175 200 + 25 000
    const r = await right(c, id, slugs[0]!);
    expect((await cartOf(c)).quote).toMatchObject({
      discount: { type: 'upgrade_right', id: r.id, amount: 43_800 },
      total: 200_200,
      staleChoice: false,
    });
  });

  it('made against the entered code alone, it ends with the code: a coupon that comes later applies by itself', async () => {
    const c = await shopper(t, ali, '998901112233');
    const id = await customerIdOf(c);
    const [x] = await slugsOf(t, 1);
    await promo('BLOGER5', 5);
    await add(c, x!, 50);
    await c.cart.applyPromoCode({ body: { code: 'BLOGER5' } });
    expect(await c.cart.chooseDiscount({ body: { type: 'none' } })).toMatchObject({
      status: 200,
      body: { quote: { discount: null, total: 244_000 } },
    });
    expect(await c.cart.removePromoCode()).toMatchObject({
      status: 200,
      body: {
        promoCode: null,
        quote: { discount: null, total: 244_000, staleChoice: false },
        discountOptions: [],
      },
    });

    const b = await coupon(id, 20);
    expect((await cartOf(c)).quote).toMatchObject({
      discount: { type: 'birthday_coupon', id: b.id, amount: 43_800 },
      total: 200_200,
      staleChoice: false,
    });
  });

  it('stays while the declined coupon is still held, though for a moment it discounts nothing', async () => {
    const { c, coupon: b, slugs } = await aliWithCoupon();
    await c.cart.chooseDiscount({ body: { type: 'none' } });
    // the 50 ml sells out: the coupon has nothing to discount, but it is still Ali's
    const [v] = await t.db
      .select({ id: volumes.id, onHand: volumes.onHand })
      .from(volumes)
      .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
      .where(and(eq(fragrances.slug, slugs[0]!), eq(volumes.ml, 50)));
    await t.db.update(volumes).set({ onHand: 0 }).where(eq(volumes.id, v!.id));
    expect((await cartOf(c)).quote).toMatchObject({ discount: null, alternatives: [] });

    // restocked: «Не применять» still holds, the coupon still waits
    await t.db.update(volumes).set({ onHand: v!.onHand }).where(eq(volumes.id, v!.id));
    expect((await cartOf(c)).quote).toMatchObject({
      discount: null,
      total: 244_000,
      alternatives: [{ discount: { type: 'birthday_coupon', id: b.id }, total: 200_200 }],
      staleChoice: false,
    });
  });
});

describe('a chosen entitlement that went stale', () => {
  it('expired: the cart falls back to the automatic choice and says so once', async () => {
    const { c, right: r, coupon: b } = await aliWithTwoEntitlements();
    await c.cart.chooseDiscount({ body: { type: 'birthday_coupon', id: b.id } });
    // its last day passes
    await endNow(b.id);
    expect((await cartOf(c)).quote).toMatchObject({
      discount: { type: 'upgrade_right', id: r.id },
      staleChoice: true,
    });
    expect((await cartOf(c)).quote).toMatchObject({
      discount: { type: 'upgrade_right', id: r.id },
      staleChoice: false,
    });
  });

  it('used by a «Купить сейчас» order: the cart falls back and says so', async () => {
    const { c, right: r, coupon: b } = await aliWithTwoEntitlements();
    const chosen = await c.cart.chooseDiscount({ body: { type: 'birthday_coupon', id: b.id } });
    if (chosen.status !== 200) throw new Error(`choose ${chosen.status}`);
    const lineId = chosen.body.lines[0]!.id;
    // a 50 ml the right does not cover: the server picks the coupon for it by itself
    const [, , , w] = await slugsOf(t, 4);
    const bought = await c.orders.create({ body: await orderBody(c, `volume:${w}:50`) });
    expect(bought).toMatchObject({
      status: 201,
      body: { discount: { type: 'birthday_coupon', id: b.id } },
    });
    // the next cart answer (here, a quantity change) says so
    const res = await c.cart.setQuantity({ params: { lineId }, body: { qty: 1 } });
    expect(res).toMatchObject({
      status: 200,
      body: { quote: { discount: { type: 'upgrade_right', id: r.id }, staleChoice: true } },
    });
  });
});

describe('«Купить сейчас»', () => {
  it('never takes the cart’s choice: it gets the automatic pick, and the cart keeps its own', async () => {
    const c = await shopper(t, ali, '998901112233');
    const id = await customerIdOf(c);
    const b = await coupon(id, 20);
    const [x, y] = await slugsOf(t, 2);
    await add(c, x!, 50);
    await c.cart.chooseDiscount({ body: { type: 'none' } });

    const checkout = await c.checkout.get({ query: { item: `volume:${y}:50` } });
    expect(checkout).toMatchObject({
      status: 200,
      body: { quote: { discount: { type: 'birthday_coupon', id: b.id }, staleChoice: false } },
    });
    const order = await c.orders.create({ body: await orderBody(c, `volume:${y}:50`) });
    expect(order).toMatchObject({
      status: 201,
      body: { discount: { type: 'birthday_coupon', id: b.id } },
    });
    // the cart still says «Не применять», and there is nothing stale about it
    expect((await cartOf(c)).quote).toMatchObject({ discount: null, staleChoice: false });
  });
});

describe('checkout honours the choice', () => {
  it('the order takes the chosen entitlement, even a costlier one', async () => {
    const { c, coupon: b } = await aliWithTwoEntitlements();
    await c.cart.chooseDiscount({ body: { type: 'birthday_coupon', id: b.id } });
    const body = await orderBody(c);
    expect(body.confirmedDiscount).toMatchObject({ type: 'birthday_coupon', id: b.id });
    const order = await c.orders.create({ body });
    expect(order).toMatchObject({
      status: 201,
      body: { discount: { type: 'birthday_coupon', id: b.id, amount: 43_050 }, total: 268_950 },
    });
    const [row] = await t.db.select().from(birthdayCoupons).where(eq(birthdayCoupons.id, b.id));
    expect(row!.usedByOrderId).not.toBeNull();
  });

  it('a choice that went stale since checkout opened is refused with the new quote (409)', async () => {
    const { c, right: r, coupon: b } = await aliWithTwoEntitlements();
    await c.cart.chooseDiscount({ body: { type: 'birthday_coupon', id: b.id } });
    const body = await orderBody(c);
    await endNow(b.id);
    const res = await c.orders.create({ body });
    expect(res).toMatchObject({
      status: 409,
      body: {
        code: 'total_changed',
        checkout: {
          quote: {
            discount: { type: 'upgrade_right', id: r.id },
            total: 257_200,
            staleChoice: true,
          },
        },
      },
    });
    // confirmed again as now shown, it goes through with the right
    const again = await c.orders.create({ body: await orderBody(c) });
    expect(again).toMatchObject({
      status: 201,
      body: { discount: { type: 'upgrade_right', id: r.id } },
    });
  });
});

describe('removing a line while a cart checkout holds the cart', () => {
  it('waits its turn behind the checkout instead of deadlocking with it', async () => {
    const c = await shopper(t, ali, '998901112233');
    const id = await customerIdOf(c);
    const [x] = await slugsOf(t, 1);
    // the last line: removing it also drops the choice on the cart row (#39)
    const lineId = (await add(c, x!, 50)).lines[0]!.id;
    const checkout = new pg.Client({ connectionString: t.env.DATABASE_URL });
    await checkout.connect();
    try {
      // as `createOrder` does: the cart row first, then (after the order) its lines
      await checkout.query('begin');
      await checkout.query('select 1 from carts where customer_id = $1 for update', [id]);
      const removing = c.cart.removeLine({ params: { lineId } });
      await untilWaitingOnLocks(checkout, 1);
      await checkout.query('delete from cart_lines where customer_id = $1', [id]);
      await checkout.query('commit');
      expect(await removing).toMatchObject({ status: 200, body: { lines: [] } });
    } finally {
      await checkout.end();
    }
  });
});
