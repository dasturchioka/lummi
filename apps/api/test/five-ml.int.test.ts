import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OrderStatus } from '@lummi/contracts';
import {
  and,
  auditLog,
  bottlings,
  cartLines,
  customers,
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  ne,
  orderEvents,
  orderLines,
  orders,
  outbox,
  stockMoves,
  upgradeRights,
  volumes,
} from '@lummi/db';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { OrderStatusService, type TransitionActor } from '../src/order-status/order-status.service';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { orderBody, samarkandPoint, shopper, slugs as slugsOf } from './harness/orders';
import { payWithCredit } from './harness/payments';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';
import type { TestUser } from './harness/sign-init-data';

/**
 * Seam 1 (ADR 0028), ticket #79: the 5 ml bottle (stocked, never sold alone), the «Discovery Set
 * 5×5 мл» as a second ready-made set, a first order's gift sample, and the set-discount scope.
 */

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
  t.edges.clock.set(new Date('2026-11-19T10:00:00Z'));
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  // no samples unless a test puts 5 ml bottles on the shelf
  await t.db.update(volumes).set({ onHand: 0 }).where(eq(volumes.ml, 5));
  await t.db.update(discoverySet).set({ onHand: 0 });
});

const ali: TestUser = { id: 71, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 72, first_name: 'Vali', language_code: 'uz' };
type Client = Awaited<ReturnType<typeof shopper>>;
const machine = () => t.app.get(OrderStatusService);
const staff = async (): Promise<TransitionActor> => ({
  type: 'staff',
  id: (await t.managerSession()).staff.id,
});

async function setSetting(key: string, value: unknown) {
  const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
  if (res.status !== 200) throw new Error(`setting ${key}: ${res.status}`);
}

/** The five fragrances of a Discovery set, in its order. */
async function compositionOf(vialMl: 5 | 10) {
  const rows = await t.db
    .select({ id: fragrances.id, slug: fragrances.slug, name: fragrances.name })
    .from(discoverySetItems)
    .innerJoin(fragrances, eq(fragrances.id, discoverySetItems.fragranceId))
    .where(eq(discoverySetItems.vialMl, vialMl))
    .orderBy(discoverySetItems.position);
  return rows;
}
const setOnHand = async (vialMl: 5 | 10) =>
  (await t.db.select().from(discoverySet).where(eq(discoverySet.vialMl, vialMl)))[0]!.onHand;
const setSetOnHand = (vialMl: 5 | 10, onHand: number) =>
  t.db.update(discoverySet).set({ onHand }).where(eq(discoverySet.vialMl, vialMl));

async function fiveMl(slug: string) {
  const [v] = await t.db
    .select({ id: volumes.id, onHand: volumes.onHand, fragranceId: volumes.fragranceId })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, 5)));
  return v!;
}
const setFiveMl = async (slug: string, onHand: number) =>
  t.db
    .update(volumes)
    .set({ onHand })
    .where(eq(volumes.id, (await fiveMl(slug)).id));

/** Checks out whatever the cart holds (or a buy-now item) and returns the order. */
async function order(client: Client, item?: string) {
  const point = await samarkandPoint(t);
  const checkout = await client.checkout.get({
    query: { regionId: point.regionId, ...(item ? { item } : {}) },
  });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({
    body: {
      ...orderBody(point.id, checkout.body.quote.total),
      confirmedDiscount: checkout.body.quote.discount,
      ...(item ? { item } : {}),
    },
  });
  if (res.status !== 201) throw new Error(`order ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
async function add(client: Client, slug: string, ml: 10 | 30 | 50) {
  const res = await client.cart.addLine({ body: { slug, ml, qty: 1 } });
  if (res.status !== 200) throw new Error(`add ${slug} ${ml}: ${res.status}`);
  return res.body;
}

const RECEIPT_IMAGE = sharp({
  create: { width: 300, height: 600, channels: 3, background: '#ffffff' },
})
  .png()
  .toBuffer();

/** Every step a real `transition()`, the payment through the receipt intake and a credit. */
async function walkTo(number: number, status: Exclude<OrderStatus, 'awaiting_payment'>) {
  const [o] = await t.db.select().from(orders).where(eq(orders.number, number));
  const { id, customerId } = o!;
  const sent = await t.app
    .get(ReceiptsService)
    .submit(customerId, number, await RECEIPT_IMAGE, { fileName: null, source: 'miniapp' });
  if (sent.kind !== 'submitted') throw new Error(`submit_receipt: ${sent.kind}`);
  await payWithCredit(t, o!, sent.receipt.id);
  if (status === 'payment_confirmed') return id;
  const manager = await staff();
  const path = [
    ['accepted', 'accept', undefined],
    ['assembling', 'start_assembly', undefined],
    ['handed_to_bts', 'hand_to_bts', { trackingNumber: 'BTS 4471 0098' }],
    ['delivered', 'deliver', undefined],
  ] as const;
  let from: OrderStatus = 'payment_confirmed';
  for (const [to, action, payload] of path) {
    const out = await machine().transition(id, action, manager, from, payload as never);
    if (out.kind !== 'done') throw new Error(`${action}: ${out.kind}`);
    if (to === status) return id;
    from = to;
  }
  throw new Error(`no path to ${status}`);
}

async function cancelByCustomer(number: number) {
  const [o] = await t.db.select().from(orders).where(eq(orders.number, number));
  const out = await machine().transition(
    o!.id,
    'cancel',
    { type: 'customer', id: o!.customerId },
    'awaiting_payment',
    { reason: 'customer_cancelled' },
  );
  if (out.kind !== 'done') throw new Error(`cancel: ${out.kind}`);
}

const linesOf = (orderId: number) =>
  t.db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId))
    .orderBy(orderLines.position);

describe('the 5 ml bottle is stocked, never sold alone', () => {
  it('every fragrance has one: price 0, off the card, the cart and «Купить сейчас»', async () => {
    const [slug] = await slugsOf(t, 1);
    expect(await fiveMl(slug!)).toBeDefined();
    await setFiveMl(slug!, 10);
    const client = await shopper(t, ali, '998901234567');

    const card = await client.catalog.fragrance({ params: { slug: slug! } });
    expect(card.status === 200 && card.body.volumes.map((v) => v.ml)).toEqual([10, 30, 50]);

    // the cart's body takes 10, 30 or 50 only; buy-now's item text likewise
    await expect(
      client.cart.addLine({ body: { slug: slug!, ml: 5 as 10, qty: 1 } }),
    ).rejects.toThrow(/got: 400/);
    await expect(client.checkout.get({ query: { item: `volume:${slug}:5` } })).rejects.toThrow(
      /got: 400/,
    );

    // a cart row naming a 5 ml (it cannot be added, but say one were there) sells nothing
    const [me] = await t.db.select().from(customers).where(eq(customers.telegramId, ali.id));
    await t.db
      .insert(cartLines)
      .values({ customerId: me!.id, volumeId: (await fiveMl(slug!)).id, qty: 1 });
    const cart = await client.cart.get();
    expect(cart.status === 200 && cart.body.lines).toEqual([]);
    expect(cart.status === 200 && cart.body.quote.itemsSubtotal).toBe(0);
  });

  it('a new fragrance from the admin form gets its 5 ml too', async () => {
    const [slug] = await slugsOf(t, 1);
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, slug!));
    const got = await owner.client.admin.catalog.fragrances.get({ params: { id: f!.id } });
    if (got.status !== 200) throw new Error('get');
    // the form never shows it
    expect(got.body.volumes.map((v) => v.ml)).toEqual([10, 30, 50]);
  });

  it('a bottling fills 5 ml bottles from the oil like any volume', async () => {
    const [slug] = await slugsOf(t, 1);
    const v = await fiveMl(slug!);
    await t.db.update(fragrances).set({ oilMg: 100_000 }).where(eq(fragrances.id, v.fragranceId));
    const res = await owner.client.admin.warehouse.bottle({
      params: { id: v.fragranceId },
      body: { lines: [{ ml: 5, quantity: 10 }] },
    });
    expect(res.status).toBe(201);
    // 5 ml × 1.03 × 30 % × density 1 = 1.545 g a bottle
    expect(res.status === 201 && res.body.oilGrams).toBe(15.45);
    expect((await fiveMl(slug!)).onHand).toBe(10);
  });
});

describe('«Discovery Set 5×5 мл», a second ready-made set (ADR 0042)', () => {
  it('sells on its own stock at its own price, apart from the 5 × 10 ml set', async () => {
    await setSetOnHand(5, 3);
    await setSetOnHand(10, 3);
    const client = await shopper(t, ali, '998901234567');
    const shown = await client.sets.discovery({ query: { vialMl: 5 } });
    expect(shown.status === 200 && shown.body).toMatchObject({
      vialMl: 5,
      price: 99_000,
      available: 3,
      soldOut: false,
    });
    expect(shown.status === 200 && shown.body.fragrances).toHaveLength(5);

    const cart = await client.cart.addDiscovery({ body: { qty: 2, vialMl: 5 } });
    expect(cart.status === 200 && cart.body.lines).toMatchObject([
      { kind: 'discovery_set', vialMl: 5, qty: 2 },
    ]);
    expect(cart.status === 200 && cart.body.quote.itemsSubtotal).toBe(198_000);

    const o = await order(client);
    expect(o.lines).toMatchObject([
      { kind: 'discovery_set', ml: 5, name: { ru: 'Discovery set 5 × 5 мл' }, unitPrice: 99_000 },
    ]);
    // the reserve: its own, never the 5 × 10 ml set's
    const after = await client.sets.discovery({ query: { vialMl: 5 } });
    expect(after.status === 200 && after.body.available).toBe(1);
    const ten = await client.sets.discovery();
    expect(ten.status === 200 && ten.body).toMatchObject({ vialMl: 10, available: 3 });
  });

  it('both sets in one cart, and «Купить сейчас» of the 5 × 5 ml one', async () => {
    await setSetOnHand(5, 3);
    await setSetOnHand(10, 3);
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 1, vialMl: 5 } });
    const both = await client.cart.addDiscovery({ body: { qty: 1 } });
    expect(
      both.status === 200 && both.body.lines.map((l) => l.kind === 'discovery_set' && l.vialMl),
    ).toEqual([5, 10]);
    expect(both.status === 200 && both.body.quote.itemsSubtotal).toBe(99_000 + 299_000);

    const o = await order(client, 'discovery_set:5');
    expect(o.lines).toMatchObject([{ kind: 'discovery_set', ml: 5, qty: 1 }]);
    expect(o.total).toBe(99_000 + o.deliveryFee);
    // the cart is left as it was
    const cart = await client.cart.get();
    expect(cart.status === 200 && cart.body.lines).toHaveLength(2);
  });

  it('a sold-out 5 × 5 ml set refuses the cart', async () => {
    const client = await shopper(t, ali, '998901234567');
    const res = await client.cart.addDiscovery({ body: { qty: 1, vialMl: 5 } });
    expect(res.status).toBe(409);
  });

  it('handover takes its boxes off its own shelf; delivery opens set rights on its five', async () => {
    await setSetOnHand(5, 4);
    await setSetOnHand(10, 4);
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 1, vialMl: 5 } });
    const o = await order(client);
    const id = await walkTo(o.number, 'handed_to_bts');
    expect(await setOnHand(5)).toBe(3);
    expect(await setOnHand(10)).toBe(4);
    const [handed] = (
      await t.db.select().from(orderEvents).where(eq(orderEvents.orderId, id))
    ).filter((e) => e.action === 'hand_to_bts');
    expect(handed!.payload).toMatchObject({
      onHand: [{ shelf: 'discovery_set', id: 5, from: 4, to: 3 }],
    });

    await walkToDelivered(id);
    const rights = await t.db
      .select()
      .from(upgradeRights)
      .where(eq(upgradeRights.sourceOrderId, id));
    const five = await compositionOf(5);
    expect(rights).toHaveLength(1);
    expect(rights[0]).toMatchObject({ source: 'set', percent: 20 });
    expect(rights[0]!.fragrances.map((f) => f.fragranceId)).toEqual(five.map((f) => f.id));

    // the right discounts a full-size bottle of one of its five
    const cart = await add(client, five[0]!.slug, 30);
    expect(cart.quote.discount).toMatchObject({ type: 'upgrade_right', source: 'set' });
  });

  it('cancelling after handover puts its box back', async () => {
    await setSetOnHand(5, 2);
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 1, vialMl: 5 } });
    const o = await order(client);
    const id = await walkTo(o.number, 'handed_to_bts');
    expect(await setOnHand(5)).toBe(1);
    const out = await machine().transition(id, 'cancel', await staff(), 'handed_to_bts', {
      reason: 'not_collected_at_bts',
    });
    expect(out.kind).toBe('done');
    expect(await setOnHand(5)).toBe(2);
  });

  it('the owner prices and composes it apart from the 5 × 10 ml set', async () => {
    const ids = (await t.db.select({ id: fragrances.id }).from(fragrances).limit(10)).map(
      (f) => f.id,
    );
    const res = await owner.client.admin.sets.update({
      query: { vialMl: 5 },
      body: { price: 109_000, composition: ids.slice(5, 10) },
    });
    expect(res.status === 200 && res.body).toMatchObject({ vialMl: 5, price: 109_000 });
    expect((await compositionOf(5)).map((f) => f.id)).toEqual(ids.slice(5, 10));
    expect((await compositionOf(10)).map((f) => f.id)).not.toEqual(ids.slice(5, 10));
    const ten = await owner.client.admin.sets.get();
    expect(ten.status === 200 && ten.body).toMatchObject({ vialMl: 10, price: 299_000 });
    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'sets.discovery_changed'));
    // the entry names its set: the audit page's Target reads «Discovery set 5 × 5 мл»
    expect(entry).toMatchObject({ targetId: 'discovery-5', payload: { vialMl: 5 } });
  });
});

describe('a Return of the 5 × 5 ml set and of a gift sample (ADR 0042)', () => {
  /** The return dialog's lines (positions in order) as the page offers them. */
  async function returnLines(number: number) {
    const manager = await t.managerSession();
    const page = await manager.client.admin.orders.get({ params: { number } });
    if (page.status !== 200 || !page.body.returnPreview) throw new Error('no return preview');
    return { manager, lines: page.body.returnPreview.lines.map((l) => l.position) };
  }

  it('a 5 × 5 ml set flagged back goes onto its own shelf, never the 5 × 10 ml one', async () => {
    await setSetOnHand(5, 4);
    await setSetOnHand(10, 4);
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 1, vialMl: 5 } });
    const o = await order(client);
    const id = await walkTo(o.number, 'handed_to_bts');
    await walkToDelivered(id);
    expect(await setOnHand(5)).toBe(3);
    const { manager, lines } = await returnLines(o.number);
    const res = await manager.client.admin.orders.return({
      params: { number: o.number },
      body: {
        expectedStatus: 'delivered',
        reason: 'Вернули коробку',
        lines: lines.map((position) => ({ position, backToStock: true })),
      },
    });
    expect(res.status).toBe(200);
    expect(await setOnHand(5)).toBe(4);
    expect(await setOnHand(10)).toBe(4);
  });

  it('a gift sample is a line of the return like any: back on hand when flagged, off when not', async () => {
    const [a, b] = await slugsOf(t, 2);
    await setFiveMl(b!, 2);
    const client = await shopper(t, ali, '998901234567');
    await add(client, a!, 30);
    const o = await order(client);
    const id = await walkTo(o.number, 'handed_to_bts');
    await walkToDelivered(id);
    expect((await fiveMl(b!)).onHand).toBe(1);
    const { manager, lines } = await returnLines(o.number);
    expect(lines).toEqual([0, 1]); // the bottle, then the sample
    const res = await manager.client.admin.orders.return({
      params: { number: o.number },
      body: {
        expectedStatus: 'delivered',
        reason: 'Вернули посылку',
        lines: [
          { position: 0, backToStock: true },
          { position: 1, backToStock: true },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect((await fiveMl(b!)).onHand).toBe(2);
    // a returned first order had its sample: the next order is no first order
    await add(client, a!, 30);
    expect((await order(client)).lines.some((l) => l.giftSample)).toBe(false);
  });

  it('a gift sample left unflagged stays off the shelf', async () => {
    const [a, b] = await slugsOf(t, 2);
    await setFiveMl(b!, 2);
    const client = await shopper(t, ali, '998901234567');
    await add(client, a!, 30);
    const o = await order(client);
    const id = await walkTo(o.number, 'handed_to_bts');
    await walkToDelivered(id);
    const { manager } = await returnLines(o.number);
    const res = await manager.client.admin.orders.return({
      params: { number: o.number },
      body: {
        expectedStatus: 'delivered',
        reason: 'Пробник открыт',
        lines: [
          { position: 0, backToStock: true },
          { position: 1, backToStock: false },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect((await fiveMl(b!)).onHand).toBe(1);
  });
});

describe('a set bottling fills boxes straight from the five oils (ADR 0042)', () => {
  it('takes one vial of oil from each of the five per box and adds the boxes', async () => {
    const five = await compositionOf(5);
    for (const f of five)
      await t.db.update(fragrances).set({ oilMg: 10_000 }).where(eq(fragrances.id, f.id));
    const res = await owner.client.admin.warehouse.bottleSet({
      params: { vialMl: 5 },
      body: { quantity: 4 },
    });
    // 4 × 1.545 g = 6.18 g of each
    expect(res.status === 201 && res.body).toMatchObject({ oilGrams: 6.18, onHand: 4 });
    expect(await setOnHand(5)).toBe(4);
    for (const f of five) {
      const [row] = await t.db.select().from(fragrances).where(eq(fragrances.id, f.id));
      expect(row!.oilMg).toBe(10_000 - 6_180);
      const moves = await t.db.select().from(stockMoves).where(eq(stockMoves.fragranceId, f.id));
      expect(moves).toMatchObject([
        {
          kind: 'bottling',
          oilMg: -6_180,
          bottles: {},
          details: { set: { vialMl: 5, quantity: 4 } },
        },
      ]);
      // the bottling row says it was the set's, so its vials never read as 5 ml on hand
      const [b] = await t.db.select().from(bottlings).where(eq(bottlings.fragranceId, f.id));
      expect(b).toMatchObject({ setVialMl: 5, lines: [{ ml: 5, quantity: 4 }], oilMg: 6_180 });
    }
    const history = await owner.client.admin.warehouse.get({ params: { id: five[0]!.id } });
    expect(history.status === 200 && history.body.history[0]).toMatchObject({
      kind: 'bottling',
      set: { vialMl: 5, quantity: 4 },
    });
  });

  it('refuses when one of the five is short, naming it, and changes nothing', async () => {
    const five = await compositionOf(5);
    for (const f of five)
      await t.db.update(fragrances).set({ oilMg: 10_000 }).where(eq(fragrances.id, f.id));
    await t.db.update(fragrances).set({ oilMg: 1_000 }).where(eq(fragrances.id, five[2]!.id));
    const res = await owner.client.admin.warehouse.bottleSet({
      params: { vialMl: 5 },
      body: { quantity: 1 },
    });
    expect(res.status === 409 && res.body).toMatchObject({
      code: 'oil_short',
      fragrance: five[2]!.name,
      neededGrams: 1.545,
      balanceGrams: 1,
    });
    expect(await setOnHand(5)).toBe(0);
    const [row] = await t.db.select().from(fragrances).where(eq(fragrances.id, five[0]!.id));
    expect(row!.oilMg).toBe(10_000);
  });
});

describe("a first order's gift sample (ADR 0042)", () => {
  it('a first order gets one 5 ml at 0, reserved, the total unchanged; the next order none', async () => {
    const [a, b] = await slugsOf(t, 2);
    await setFiveMl(a!, 2);
    await setFiveMl(b!, 5);
    const client = await shopper(t, ali, '998901234567');
    await add(client, a!, 30);
    const first = await order(client);
    expect(first.lines).toHaveLength(2);
    // the most-stocked fragrance's 5 ml
    const [bName] = await t.db.select().from(fragrances).where(eq(fragrances.slug, b!));
    expect(first.lines[1]).toMatchObject({
      kind: 'volume',
      ml: 5,
      name: { ru: bName!.name },
      unitPrice: 0,
      regularUnitPrice: 0,
      lineTotal: 0,
      qty: 1,
      giftSample: true,
      promoGift: false,
    });
    expect(first.itemsSubtotal).toBe(first.lines[0]!.lineTotal);
    expect(first.total).toBe(first.itemsSubtotal + first.deliveryFee);
    // the bottle is reserved: on hand stays, another first order sees one fewer
    expect((await fiveMl(b!)).onHand).toBe(5);
    // the bot's «Заказ оформлен» names it
    const [created] = await t.db.select().from(outbox).orderBy(outbox.id);
    expect(created!.text).toContain(`В подарок к первому заказу: пробник ${bName!.name} 5 мл.`);

    await add(client, a!, 30);
    const second = await order(client);
    expect(second.lines.some((l) => l.giftSample)).toBe(false);
  });

  it('rides with any discount: it is not one', async () => {
    const [a, b] = await slugsOf(t, 2);
    await setFiveMl(b!, 1);
    const created = await owner.client.admin.promoCodes.create({
      body: {
        code: 'WELCOME10',
        kind: 'percent',
        percent: 10,
        amount: null,
        maxDiscount: null,
        promoGift: null,
        expiresOn: null,
        minOrderTotal: null,
        totalLimit: null,
        perCustomerLimit: null,
        newCustomersOnly: true,
        appliesToMarkedDown: false,
        active: true,
      },
    });
    expect(created.status).toBe(201);
    const client = await shopper(t, ali, '998901234567');
    const cart = await add(client, a!, 50);
    await client.cart.applyPromoCode({ body: { code: 'WELCOME10' } });
    const o = await order(client);
    expect(o.discount).toMatchObject({ type: 'promo_code', code: 'WELCOME10' });
    expect(o.total).toBeLessThan(o.itemsSubtotal + o.deliveryFee);
    expect(o.itemsSubtotal).toBe(cart.quote.itemsSubtotal);
    expect(o.lines.filter((l) => l.giftSample)).toHaveLength(1);
  });

  it('a cancelled first order does not spend it; a delivered one does', async () => {
    const [a, b] = await slugsOf(t, 2);
    await setFiveMl(b!, 3);
    const client = await shopper(t, ali, '998901234567');
    await add(client, a!, 30);
    const first = await order(client);
    expect(first.lines.some((l) => l.giftSample)).toBe(true);
    await cancelByCustomer(first.number);
    // the cancelled order gave its bottle back
    await add(client, a!, 30);
    const again = await order(client);
    expect(again.lines.filter((l) => l.giftSample)).toHaveLength(1);
    await walkTo(again.number, 'payment_confirmed');
    await add(client, a!, 30);
    const third = await order(client);
    expect(third.lines.some((l) => l.giftSample)).toBe(false);
  });

  it('out of 5 ml, switched off, or a named fragrance out of stock: no sample, the order goes on', async () => {
    const [a, b, c] = await slugsOf(t, 3);
    const client = await shopper(t, ali, '998901234567');
    await add(client, a!, 30);
    expect((await order(client)).lines.some((l) => l.giftSample)).toBe(false);

    const other = await shopper(t, vali, '998901234568');
    await setFiveMl(b!, 3);
    await setSetting('giftSample.enabled', false);
    await add(other, a!, 30);
    const off = await order(other);
    expect(off.lines.some((l) => l.giftSample)).toBe(false);
    await cancelByCustomer(off.number);

    await setSetting('giftSample.enabled', true);
    const [named] = await t.db.select().from(fragrances).where(eq(fragrances.slug, c!));
    await setSetting('giftSample.fragranceId', named!.id);
    await add(other, a!, 30);
    const none = await order(other);
    expect(none.lines.some((l) => l.giftSample)).toBe(false);
    await cancelByCustomer(none.number);

    await setFiveMl(c!, 1);
    await add(other, a!, 30);
    const given = await order(other);
    expect(given.lines.find((l) => l.giftSample)).toMatchObject({ name: { ru: named!.name } });
  });

  it('the last bottle goes to one first order only', async () => {
    const [a, b] = await slugsOf(t, 2);
    await setFiveMl(b!, 1);
    const one = await shopper(t, ali, '998901234567');
    const two = await shopper(t, vali, '998901234568');
    await add(one, a!, 30);
    await add(two, a!, 30);
    const [x, y] = await Promise.all([order(one), order(two)]);
    const samples = [x, y].filter((o) => o.lines.some((l) => l.giftSample));
    expect(samples).toHaveLength(1);
  });

  it('is handed over and returned like a line; its cost is in the profit, not in the goods', async () => {
    const [a, b] = await slugsOf(t, 2);
    await setFiveMl(b!, 2);
    const ids = await t.db.select({ id: fragrances.id, slug: fragrances.slug }).from(fragrances);
    const idOf = (s: string) => ids.find((f) => f.slug === s)!.id;
    await t.db
      .update(fragrances)
      .set({ oilPrice: 3950 })
      .where(eq(fragrances.id, idOf(a!)));
    await t.db
      .update(fragrances)
      .set({ oilPrice: 3950 })
      .where(eq(fragrances.id, idOf(b!)));
    const client = await shopper(t, ali, '998901234567');
    await add(client, a!, 30);
    const o = await order(client);
    const id = await walkTo(o.number, 'payment_confirmed');
    const [row] = await t.db.select().from(orders).where(eq(orders.id, id));
    const lines = await linesOf(id);
    // the calculator's `giftCost` for oil 3 950 at the defaults (unit-cost table): 10 956
    expect(lines[1]).toMatchObject({ giftSample: true, unitCost: 10_956 });
    expect(row!.costs!.profit).toMatchObject({
      goods: lines[0]!.unitCost,
      giftSample: 10_956,
    });

    await walkToFrom(id, 'payment_confirmed', 'handed_to_bts');
    expect((await fiveMl(b!)).onHand).toBe(1);
    const moves = await t.db
      .select()
      .from(stockMoves)
      .where(and(eq(stockMoves.fragranceId, idOf(b!)), eq(stockMoves.kind, 'sale')));
    expect(moves).toMatchObject([{ bottles: { 5: -1 } }]);
    // no right from a sample
    await walkToFrom(id, 'handed_to_bts', 'delivered');
    const rights = await t.db
      .select()
      .from(upgradeRights)
      .where(eq(upgradeRights.sourceOrderId, id));
    expect(rights).toEqual([]);
  });

  it("the admin order, the Excel and the customer's order page name it", async () => {
    const [a, b] = await slugsOf(t, 2);
    await setFiveMl(b!, 1);
    const client = await shopper(t, ali, '998901234567');
    await add(client, a!, 30);
    const o = await order(client);
    const mine = await client.orders.get({ params: { number: o.number } });
    expect(mine.status === 200 && mine.body.lines[1]).toMatchObject({ giftSample: true });
    const admin = await owner.client.admin.orders.get({ params: { number: o.number } });
    expect(admin.status === 200 && admin.body.order.lines[1]).toMatchObject({ giftSample: true });
  });
});

describe("the gift sample's 5 ml stock warns before it runs out (#79)", () => {
  const stockOf = async () => {
    const res = await owner.client.admin.stock.list({ query: { page: 1, pageSize: 10 } });
    if (res.status !== 200) throw new Error(`stock ${res.status}`);
    return res.body.giftSample;
  };
  const homeSample = async () => {
    const res = await owner.client.admin.home();
    if (res.status !== 200) throw new Error(`home ${res.status}`);
    const first = res.body.queues.stock.first;
    return { first, count: res.body.queues.stock.count };
  };

  it('most stocked: all visible 5 ml together against `giftSample.lowStock`', async () => {
    expect(await stockOf()).toEqual({
      fragrance: null,
      missing: false,
      available: 0,
      threshold: 10,
      level: 'zero',
    });
    // nothing else is short, so the samples are what Home names first
    await t.db.update(volumes).set({ onHand: 50 }).where(ne(volumes.ml, 5));
    await t.db.update(discoverySet).set({ onHand: 50 });
    expect((await homeSample()).first).toMatchObject({ kind: 'sample', name: null, level: 'zero' });

    const [a, b] = await slugsOf(t, 2);
    await setFiveMl(a!, 4);
    await setFiveMl(b!, 5);
    expect(await stockOf()).toMatchObject({ available: 9, level: 'low' });
    await setFiveMl(b!, 7);
    expect(await stockOf()).toMatchObject({ available: 11, level: 'ok' });
    expect((await homeSample()).count).toBe(0);
  });

  it('a chosen fragrance: its own 5 ml; hidden or gone, it says so instead of going quiet', async () => {
    await t.db.update(volumes).set({ onHand: 50 }).where(ne(volumes.ml, 5));
    await t.db.update(discoverySet).set({ onHand: 50 });
    const [a] = await slugsOf(t, 1);
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, a!));
    await setFiveMl(a!, 3);
    await setSetting('giftSample.fragranceId', f!.id);
    expect(await stockOf()).toEqual({
      fragrance: f!.name,
      missing: false,
      available: 3,
      threshold: 10,
      level: 'low',
    });
    expect((await homeSample()).first).toMatchObject({ kind: 'sample', name: f!.name });

    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.id, f!.id));
    expect(await stockOf()).toMatchObject({ missing: true, available: 0, level: 'zero' });

    await setSetting('giftSample.fragranceId', 999_999);
    expect(await stockOf()).toMatchObject({ fragrance: null, missing: true });

    await setSetting('giftSample.enabled', false);
    expect(await stockOf()).toBeNull();
  });
});

describe('the set-discount scope (entitlements.setDiscountScope)', () => {
  async function rightFromSet() {
    await setSetOnHand(5, 2);
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 1, vialMl: 5 } });
    const o = await order(client);
    await walkTo(o.number, 'delivered');
    const five = await compositionOf(5);
    const outside = (await t.db.select().from(fragrances)).find(
      (f) => !five.some((x) => x.id === f.id),
    )!;
    return { client, five, outside };
  }

  it('set_fragrances (the default): a fragrance outside the set gets nothing', async () => {
    const { client, outside } = await rightFromSet();
    const cart = await add(client, outside.slug, 50);
    expect(cart.quote.discount).toBeNull();
    const card = await client.catalog.fragrance({ params: { slug: outside.slug } });
    expect(card.status === 200 && card.body.upgradeRightPrices).toEqual([]);
  });

  it("any_fragrance: any full-size bottle gets the set's %, the card and «Мои скидки» say so", async () => {
    const { client, outside } = await rightFromSet();
    await setSetting('entitlements.setDiscountScope', 'any_fragrance');
    const cart = await add(client, outside.slug, 50);
    expect(cart.quote.discount).toMatchObject({
      type: 'upgrade_right',
      source: 'set',
      percent: 20,
    });
    const card = await client.catalog.fragrance({ params: { slug: outside.slug } });
    expect(card.status === 200 && card.body.upgradeRightPrices.map((p) => p.ml)).toEqual([30, 50]);
    const mine = await client.me.discounts();
    expect(mine.status === 200 && mine.body.upgradeRights[0]).toMatchObject({ anyFragrance: true });
  });
});

/** The rest of the walk from `delivered`'s predecessor (the tests above stop at a status). */
async function walkToDelivered(id: number) {
  await walkToFrom(id, 'handed_to_bts', 'delivered');
}
async function walkToFrom(
  id: number,
  from: OrderStatus,
  to: Exclude<OrderStatus, 'awaiting_payment'>,
) {
  const manager = await staff();
  const path = [
    ['payment_confirmed', 'accepted', 'accept', undefined],
    ['accepted', 'assembling', 'start_assembly', undefined],
    ['assembling', 'handed_to_bts', 'hand_to_bts', { trackingNumber: 'BTS 4471 0098' }],
    ['handed_to_bts', 'delivered', 'deliver', undefined],
  ] as const;
  let at: OrderStatus = from;
  for (const [f, next, action, payload] of path) {
    if (f !== at) continue;
    const out = await machine().transition(id, action, manager, at, payload as never);
    if (out.kind !== 'done') throw new Error(`${action}: ${out.kind}`);
    at = next;
    if (at === to) return;
  }
  if (at !== to) throw new Error(`no path from ${from} to ${to}`);
}
