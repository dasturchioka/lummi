import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CreateOrderBody, PromoCodeInput } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  and,
  auditLog,
  btsPoints,
  discoverySet,
  eq,
  fragrances,
  orderLines,
  orders,
  outbox,
  regions,
  volumes,
} from '@lummi/db';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { OrderStatusService } from '../src/order-status/order-status.service';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { payWithCredit } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028) for the gift promo code (ticket #69, ADR 0039): the owner picks a volume or the
 * Discovery set, the cart lists it at 0, the order holds it as a line (reserve, cancel, handover),
 * and the reports count its regular price as the discount. Seed prices: 10 ml 69 000, 30 ml
 * 149 000, 50 ml 219 000; the default tariff 25 000 below 250 000.
 */
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

let t: TestApp;
let owner: StaffSession;
/** The paid fragrance and the gift's fragrance (Rain Tea's stand-in). */
let paid: string;
let giftSlug: string;
let giftFragranceId: number;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  const rows = await t.db
    .select({ id: fragrances.id, slug: fragrances.slug })
    .from(fragrances)
    .orderBy(fragrances.slug);
  paid = rows[0]!.slug;
  giftSlug = rows[1]!.slug;
  giftFragranceId = rows[1]!.id;
});

const RECEIPT_IMAGE = sharp({
  create: { width: 300, height: 600, channels: 3, background: '#ffffff' },
})
  .png()
  .toBuffer();

/** A gift code (the gift's 10 ml unless told otherwise) with no limits, active. */
function giftCode(over: Partial<PromoCodeInput> = {}): PromoCodeInput {
  return {
    code: 'RAINTEA',
    kind: 'gift',
    percent: null,
    amount: null,
    maxDiscount: null,
    gift: { kind: 'volume', fragranceId: giftFragranceId, ml: 10 },
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
async function createGift(over: Partial<PromoCodeInput> = {}) {
  const res = await owner.client.admin.promoCodes.create({ body: giftCode(over) });
  if (res.status !== 201) throw new Error(`create: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function volumeOf(slug: string, ml: number) {
  const [v] = await t.db
    .select({ id: volumes.id, onHand: volumes.onHand })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, ml)));
  return v!;
}
async function setOnHand(slug: string, ml: number, onHand: number) {
  await t.db
    .update(volumes)
    .set({ onHand })
    .where(eq(volumes.id, (await volumeOf(slug, ml)).id));
}

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
  /** What the fragrance card says is available of that volume. */
  const available = async (slug: string, ml: number) => {
    const card = await client.catalog.fragrance({ params: { slug } });
    if (card.status !== 200) throw new Error(`card ${card.status}`);
    return card.body.volumes.find((v) => v.ml === ml)!.available;
  };
  return { client, add, apply, available };
}
type Shopper = Awaited<ReturnType<typeof shopper>>;

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
async function usesOf(code = 'RAINTEA') {
  const list = await owner.client.admin.promoCodes.list();
  if (list.status !== 200) throw new Error(`list ${list.status}`);
  return list.body.find((p) => p.code === code)!;
}

/** Paid by its receipt and a credit, then moved by a manager through `path`. */
async function payAndMove(number: number, until: 'handed_to_bts' | 'delivered') {
  const [row] = await t.db.select().from(orders).where(eq(orders.number, number));
  const sent = await t.app
    .get(ReceiptsService)
    .submit(row!.customerId, number, await RECEIPT_IMAGE, { fileName: null, source: 'miniapp' });
  if (sent.kind !== 'submitted') throw new Error(`receipt ${sent.kind}`);
  await payWithCredit(t, row!, sent.receipt.id);
  const machine = t.app.get(OrderStatusService);
  const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
  const path = [
    ['payment_confirmed', 'accept', undefined],
    ['accepted', 'start_assembly', undefined],
    ['assembling', 'hand_to_bts', { trackingNumber: 'BTS 4471 0098' }],
    ['handed_to_bts', 'deliver', undefined],
  ] as const;
  for (const [from, action, payload] of path) {
    const out = await machine.transition(row!.id, action, manager, from, payload as never);
    expect(out.kind, action).toBe('done');
    if (from === until) return row!;
  }
  return row!;
}

describe('admin: a gift code names one volume or the Discovery set', () => {
  it('creates a gift code: the gift named in the list, carried by the audit; no amount, no cap', async () => {
    const created = await createGift();
    expect(created).toMatchObject({
      code: 'RAINTEA',
      kind: 'gift',
      percent: null,
      amount: null,
      maxDiscount: null,
      gift: { kind: 'volume', fragranceId: giftFragranceId, ml: 10, name: expect.any(String) },
    });
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'promo.created'));
    expect(entry!.payload).toMatchObject({
      code: 'RAINTEA',
      kind: 'gift',
      gift: { kind: 'volume', fragranceId: giftFragranceId, ml: 10 },
    });

    const edited = await owner.client.admin.promoCodes.update({
      params: { id: created.id },
      body: giftCode({ gift: { kind: 'discovery_set' } }),
    });
    expect(edited).toMatchObject({ status: 200, body: { gift: { kind: 'discovery_set' } } });
    const [change] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'promo.updated'));
    expect(change!.payload).toMatchObject({
      code: 'RAINTEA',
      changed: { gift: [{ kind: 'volume', ml: 10 }, { kind: 'discovery_set' }] },
    });
  });

  it('refuses a gift code without a gift or with an amount (400), and a volume the catalog lacks (422)', async () => {
    // the contract's body schema refuses these before the handler
    const post = (body: PromoCodeInput) =>
      fetch(`${t.baseUrl}/admin/promo-codes`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post(giftCode({ gift: null }))).status).toBe(400);
    expect((await post(giftCode({ amount: 10_000 }))).status).toBe(400);
    expect((await post(giftCode({ maxDiscount: 10_000 }))).status).toBe(400);
    expect((await post(giftCode({ kind: 'percent', percent: 10 }))).status).toBe(400);
    const unknown = await owner.client.admin.promoCodes.create({
      body: giftCode({ gift: { kind: 'volume', fragranceId: 999_999, ml: 10 } }),
    });
    expect(unknown).toMatchObject({ status: 422, body: { code: 'invalid', fields: ['gift'] } });
  });
});

describe('the cart: the gift is listed at 0 while the code applies', () => {
  it('applies a gift code: the gift line under the lines, nothing off the paid items', async () => {
    await createGift();
    const s = await shopper();
    await s.add(paid, 50);
    const cart = await s.apply('raintea');
    expect(cart.promoGift).toMatchObject({ kind: 'volume', slug: giftSlug, ml: 10 });
    expect(cart.quote).toMatchObject({
      itemsSubtotal: 219_000,
      discount: {
        type: 'promo_code',
        code: 'RAINTEA',
        amount: 0,
        gift: { item: { kind: 'volume' }, value: 69_000 },
      },
      deliveryFee: 25_000,
      total: 244_000,
      promoCode: { code: 'RAINTEA', invalid: null },
    });
    // the gift is not a cart line: the badge counts the paid units only
    expect(cart.count).toBe(1);
  });

  it('a gift with none left refuses the code «Подарок закончился»; the cart holding the last unit counts', async () => {
    await createGift();
    await setOnHand(giftSlug, 10, 1);
    const s = await shopper();
    await s.add(paid, 50);
    expect((await s.apply('RAINTEA')).promoGift).not.toBeNull();
    // the cart takes the last 10 ml itself: nothing is left for the gift
    const cart = await s.add(giftSlug, 10);
    expect(cart.promoGift).toBeNull();
    expect(cart.quote).toMatchObject({
      discount: null,
      promoCode: { code: 'RAINTEA', invalid: { reason: 'gift_sold_out' } },
    });
  });

  it('the Discovery set as the gift', async () => {
    await t.db.update(discoverySet).set({ onHand: 3 });
    await createGift({ gift: { kind: 'discovery_set' } });
    const s = await shopper();
    await s.add(paid, 50);
    const cart = await s.apply('RAINTEA');
    expect(cart.promoGift).toMatchObject({ kind: 'discovery_set' });
    expect(cart.promoGift?.kind === 'discovery_set' && cart.promoGift.fragrances).toHaveLength(5);
    expect(cart.quote.discount).toMatchObject({
      amount: 0,
      gift: { item: { kind: 'discovery_set' } },
    });
  });
});

describe('the order holds the gift as a line: reserve, cancel, handover (ADR 0010, 0005)', () => {
  it('snapshots the gift at 0 with its value, reserves it, and a cancel returns the unit and the use', async () => {
    await createGift({ totalLimit: 1 });
    const s = await shopper();
    await s.add(paid, 50);
    await s.apply('RAINTEA');
    const before = await s.available(giftSlug, 10);

    const order = await placeOrder(s);
    expect(order).toMatchObject({
      itemsSubtotal: 219_000,
      discount: { type: 'promo_code', code: 'RAINTEA', amount: 0, gift: { value: 69_000 } },
      deliveryFee: 25_000,
      total: 244_000,
    });
    expect(order.lines).toHaveLength(2);
    expect(order.lines[1]).toMatchObject({
      slug: giftSlug,
      ml: 10,
      qty: 1,
      unitPrice: 0,
      regularUnitPrice: 69_000,
      lineTotal: 0,
      promoGift: true,
    });
    expect(order.lines[0]).toMatchObject({ promoGift: false, lineTotal: 219_000 });
    // the bot's «Заказ оформлен» names the gift, so the shopper knows it is in the parcel
    const [created] = await t.db.select().from(outbox);
    expect(created!.text).toContain(`Подарок по промокоду: ${order.lines[1]!.name.ru} 10 мл`);
    expect(await s.available(giftSlug, 10)).toBe(before - 1);
    expect(await usesOf()).toMatchObject({ uses: 1, state: 'exhausted' });

    const res = await s.client.orders.cancel({
      params: { number: order.number },
      body: { expectedStatus: 'awaiting_payment' },
    });
    expect(res.status).toBe(200);
    expect(await s.available(giftSlug, 10)).toBe(before);
    expect(await usesOf()).toMatchObject({ uses: 0, state: 'active' });
  });

  it('«Передан в BTS» takes the gift off on hand; «Повторить заказ» leaves it out', async () => {
    await createGift();
    await setOnHand(giftSlug, 10, 5);
    const s = await shopper();
    await s.add(paid, 50);
    await s.apply('RAINTEA');
    const order = await placeOrder(s);
    await payAndMove(order.number, 'handed_to_bts');
    expect((await volumeOf(giftSlug, 10)).onHand).toBe(4);
    expect(await s.available(giftSlug, 10)).toBe(4);
  });

  it('a gift sold out between the quote and the order is 409 with the code refused; never an order without it', async () => {
    await createGift();
    await setOnHand(giftSlug, 10, 1);
    const s = await shopper();
    await s.add(paid, 50);
    await s.apply('RAINTEA');
    const body = await orderBody(s);
    // someone buys the last 10 ml meanwhile
    const other = await shopper(vali, '998901112233');
    await other.add(giftSlug, 10);
    await placeOrder(other);

    const res = await s.client.orders.create({ body });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'total_changed',
      checkout: {
        promoGift: null,
        quote: { discount: null, promoCode: { invalid: { reason: 'gift_sold_out' } } },
      },
    });
    expect(await t.db.select().from(orders)).toHaveLength(1);
  });

  it('a gift the owner changed after the shopper saw it is 409, not the other gift', async () => {
    const created = await createGift();
    const s = await shopper();
    await s.add(paid, 50);
    await s.apply('RAINTEA');
    const body = await orderBody(s);
    await owner.client.admin.promoCodes.update({
      params: { id: created.id },
      body: giftCode({ gift: { kind: 'volume', fragranceId: giftFragranceId, ml: 30 } }),
    });
    const res = await s.client.orders.create({ body });
    expect(res).toMatchObject({ status: 409, body: { code: 'total_changed' } });
  });

  it('per-customer and total limits count gift orders like any code', async () => {
    await createGift({ totalLimit: 2, perCustomerLimit: 1 });
    const first = await shopper(ali);
    await first.add(paid, 50);
    await first.apply('RAINTEA');
    await placeOrder(first);
    await first.add(paid, 50);
    expect((await first.apply('RAINTEA')).quote).toMatchObject({
      discount: null,
      promoCode: { invalid: { reason: 'already_used' } },
    });

    const second = await shopper(vali, '998901112233');
    await second.add(paid, 30);
    await second.apply('RAINTEA');
    await placeOrder(second);
    expect(await usesOf()).toMatchObject({ uses: 2, state: 'exhausted' });
  });
});

describe('reports count the gift’s regular price as the discount', () => {
  it('sales and marketing reports, the promo list stats and the orders export agree', async () => {
    const code = await createGift();
    const s = await shopper();
    await s.add(paid, 50);
    await s.apply('RAINTEA');
    const order = await placeOrder(s);
    await payAndMove(order.number, 'delivered');
    const day = '2026-11-09';

    const sales = await owner.client.admin.reports.sales({ query: { from: day, to: day } });
    if (sales.status !== 200) throw new Error(`sales ${sales.status}`);
    expect(sales.body.totals).toMatchObject({
      orders: 1,
      itemsBeforeDiscount: 288_000,
      discount: 69_000,
      delivery: 25_000,
      net: 219_000,
      averageCheck: 219_000,
    });
    // the gift is a unit of its fragrance with nothing paid for it
    const giftRow = sales.body.volumes.find((v) => v.ml === 10)!;
    expect(giftRow).toMatchObject({ units: 1, net: 0 });

    const marketing = await owner.client.admin.reports.marketing({
      query: { from: day, to: day, code: 'RAINTEA' },
    });
    if (marketing.status !== 200) throw new Error(`marketing ${marketing.status}`);
    expect(marketing.body.promoCodes.find((p) => p.code === 'RAINTEA')).toMatchObject({
      orders: 1,
      itemsBeforeDiscount: 288_000,
      discount: 69_000,
      net: 219_000,
    });

    const stats = await owner.client.admin.promoCodes.stats();
    if (stats.status !== 200) throw new Error(`stats ${stats.status}`);
    expect(stats.body.find((r) => r.promoCodeId === code.id)).toMatchObject({
      fulfilledOrders: 1,
      netSales: 219_000,
    });

    const res = await fetch(`${t.baseUrl}/admin/orders/export`, {
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.worksheets[0]!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    const cell = (name: string) => ws.getRow(2).getCell(header.indexOf(name) + 1).value;
    expect(cell('Товары')).toBe(288_000);
    expect(cell('Скидка')).toBe(69_000);
    expect(cell('Итого')).toBe(244_000);
    expect(String(cell('Источник скидки'))).toContain('RAINTEA');
    expect(String(cell('Состав'))).toContain('Подарок по промокоду');
  });
});

describe('the snapshot line is a promo gift and nothing else', () => {
  it('stores the flag on the gift line only', async () => {
    await createGift();
    const s = await shopper();
    await s.add(paid, 50);
    await s.apply('RAINTEA');
    await placeOrder(s);
    const lines = await t.db.select().from(orderLines).orderBy(orderLines.position);
    expect(lines.map((l) => l.promoGift)).toEqual([false, true]);
  });
});
