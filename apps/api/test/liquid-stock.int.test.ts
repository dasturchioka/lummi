import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OilReceiptInput } from '@lummi/contracts';
import {
  consumables,
  eq,
  migrateDb,
  SEEDED_CONSUMABLES,
  settings,
  stockMoves,
  type StockMoveRow,
} from '@lummi/db';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { fulfilTo, orderRow, pay, placeOrder, signedIn } from './harness/fulfilment';
import { shopper, slugs as slugsOf, whileTableLocked, orderBody, samarkandPoint } from './harness/orders';
import type { TestUser } from './harness/sign-init-data';
import {
  concentrateUl,
  consumable,
  FILL_UL,
  fragranceIdOf,
  setConcentrateUl,
  setConsumable,
  stockBottles,
} from './harness/stock';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): stock in liquid (#82, ADR 0043). A fragrance's bottles are filled from its
 * ready concentrate when they ship; a fill is ml × 1.03 at the default filling loss (10 ml = 10.3
 * ml). Mixing takes the oil (30 %, density 1) and the ethanol (70 %) of the ml made, no loss.
 */
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
  t.edges.clock.set(new Date('2026-11-21T10:00:00Z'));
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  manager = await t.managerSession();
  // the gift sample would take a 5 ml fill of its own; tests that want it switch it back on
  await t.db
    .insert(settings)
    .values({ key: 'giftSample.enabled', value: false })
    .onConflictDoUpdate({ target: settings.key, set: { value: false } });
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

const RECEIPT: OilReceiptInput = {
  supplier: 'Test Oils',
  invoice: 'INV-0001',
  receivedOn: '2026-11-20',
  grams: 100,
  pricePerGram: 4000,
  discountPercent: 9,
  importPercent: 3,
};

async function card(slug: string) {
  const { client } = await t.signIn(ali);
  const res = await client.catalog.fragrance({ params: { slug } });
  if (res.status !== 200) throw new Error(`card ${res.status}`);
  return Object.fromEntries(res.body.volumes.map((v) => [v.ml, v.available]));
}

async function movesOf(fragranceId: number): Promise<StockMoveRow[]> {
  return t.db.select().from(stockMoves).where(eq(stockMoves.fragranceId, fragranceId));
}

async function onHandOf(id: number) {
  const [c] = await t.db.select().from(consumables).where(eq(consumables.id, id));
  return { onHand: c!.onHand, needsRecount: c!.needsRecount };
}

/** A shopper's cart holding these lines, ordered, paid and walked to `status`. */
async function orderOf(
  user: TestUser,
  phone: string,
  lines: { slug: string; ml: 10 | 30 | 50; qty: number }[],
) {
  const client = await shopper(t, user, phone);
  for (const l of lines) {
    const res = await client.cart.addLine({ body: l });
    if (res.status !== 200) throw new Error(`add ${l.slug}: ${res.status}`);
  }
  return { client, order: await placeOrder(t, client) };
}

describe('available bottles come from the ready concentrate', () => {
  it('every volume of a fragrance shares one liquid; the reserve is its fills', async () => {
    const [a] = await slugsOf(t, 1);
    // 61.8 ml = six 10 ml fills
    await setConcentrateUl(t, a!, 6 * FILL_UL[10]);
    expect(await card(a!)).toEqual({ 10: 6, 30: 2, 50: 1 });

    // an order for one 30 ml holds 30.9 ml: three 10 ml fills are left, no 50 ml
    await orderOf(ali, '998901234567', [{ slug: a!, ml: 30, qty: 1 }]);
    expect(await card(a!)).toEqual({ 10: 3, 30: 1, 50: 0 });

    // the warehouse page says the same in ml
    const id = await fragranceIdOf(t, a!);
    const page = await manager.client.admin.warehouse.get({ params: { id } });
    expect(page.status === 200 && page.body.stock).toMatchObject({
      concentrateMl: 61.8,
      reservedMl: 30.9,
      availableMl: 30.9,
      belowReserve: false,
      bottles: [
        { ml: 10, available: 3 },
        { ml: 30, available: 1 },
        { ml: 50, available: 0 },
      ],
    });
  });

  it('a cart takes its lines in order from the one liquid', async () => {
    const [a] = await slugsOf(t, 1);
    await setConcentrateUl(t, a!, 6 * FILL_UL[10]);
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addLine({ body: { slug: a!, ml: 30, qty: 1 } });
    const res = await client.cart.addLine({ body: { slug: a!, ml: 10, qty: 5 } });
    expect(res.status).toBe(200);
    const cart = await client.cart.get();
    if (cart.status !== 200) throw new Error('cart');
    const ten = cart.body.lines.find((l) => l.kind === 'volume' && l.ml === 10)!;
    // 61.8 − 30.9 = 30.9 ml left after the 30 ml line: three 10 ml
    expect(ten).toMatchObject({ qty: 3, available: 3, limited: true });
  });

  it('a builder set takes a 10 ml fill of each of its five', async () => {
    const five = await slugsOf(t, 5);
    for (const s of five) await setConcentrateUl(t, s, 100_000);
    // the scarcest: two 10 ml fills
    await setConcentrateUl(t, five[2]!, 2 * FILL_UL[10]);
    expect((await card(five[2]!))[10]).toBe(2);

    // an order for one builder set holds a fill of each: one 10 ml of the scarcest is left
    const buyer = await shopper(t, vali, '998907654321');
    const added = await buyer.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    expect(added.status).toBe(200);
    await placeOrder(t, buyer);
    expect((await card(five[2]!))[10]).toBe(1);
    expect(await concentrateUl(t, five[0]!)).toBe(100_000);
  });
});

describe('the last ml is sold once', () => {
  it('two checkouts for different volumes of one liquid: one wins, the other sees it gone', async () => {
    const [a] = await slugsOf(t, 1);
    // 30.9 ml: one 30 ml or three 10 ml, never both a 30 ml and a 10 ml
    await setConcentrateUl(t, a!, FILL_UL[30]);
    const point = await samarkandPoint(t);
    const first = await shopper(t, ali, '998901234567');
    const second = await shopper(t, vali, '998907654321');
    await first.cart.addLine({ body: { slug: a!, ml: 30, qty: 1 } });
    await second.cart.addLine({ body: { slug: a!, ml: 10, qty: 1 } });
    const totalOf = async (c: typeof first) => {
      const res = await c.checkout.get({ query: { regionId: point.regionId } });
      if (res.status !== 200) throw new Error('checkout');
      return res.body.quote.total;
    };
    const [t1, t2] = [await totalOf(first), await totalOf(second)];

    // both read the stock before either has written its lines: only the fragrance's row lock keeps
    // the second from filling a bottle from the same ml
    const results = await whileTableLocked(t, 'order_lines', () =>
      Promise.all([
        first.orders.create({ body: orderBody(point.id, t1) }),
        second.orders.create({ body: orderBody(point.id, t2) }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await card(a!)).toEqual({ 10: 0, 30: 0, 50: 0 });
  });
});

describe('handover, return, Uzum and void move the liquid and the consumables', () => {
  it('BTS handover fills the bottles: liquid, flacons and boxes off; a return to stock puts them back', async () => {
    const [a] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, a!);
    await setConcentrateUl(t, id, 100_000);
    const flacon = await consumable(t, 'flacon', 10);
    const box = await consumable(t, 'box', 10);
    await setConsumable(t, flacon.id, 5);
    await setConsumable(t, box.id, 5);

    const { order } = await orderOf(ali, '998901234567', [{ slug: a!, ml: 10, qty: 2 }]);
    await pay(t, order.number);
    await fulfilTo(t, order.number, 'handed_to_bts');
    expect(await concentrateUl(t, id)).toBe(100_000 - 2 * FILL_UL[10]);
    expect(await onHandOf(flacon.id)).toEqual({ onHand: 3, needsRecount: false });
    expect(await onHandOf(box.id)).toEqual({ onHand: 3, needsRecount: false });
    const sale = (await movesOf(id)).find((m) => m.kind === 'sale')!;
    expect(sale).toMatchObject({
      concentrateUl: -2 * FILL_UL[10],
      bottles: { 10: -2 },
      consumables: { [flacon.id]: -2, [box.id]: -2 },
      orderId: order.id,
    });

    await fulfilTo(t, order.number, 'delivered');
    const page = await manager.client.admin.orders.get({ params: { number: order.number } });
    if (page.status !== 200 || !page.body.returnPreview) throw new Error('order page');
    const back = await manager.client.admin.orders.return({
      params: { number: order.number },
      body: {
        expectedStatus: 'delivered',
        reason: 'Не подошёл',
        lines: page.body.returnPreview.lines.map((l) => ({ position: l.position, backToStock: true })),
      },
    });
    expect(back.status).toBe(200);
    expect(await concentrateUl(t, id)).toBe(100_000);
    expect((await onHandOf(flacon.id)).onHand).toBe(5);
    expect((await onHandOf(box.id)).onHand).toBe(5);
    expect((await movesOf(id)).find((m) => m.kind === 'returned')).toMatchObject({
      concentrateUl: 2 * FILL_UL[10],
      consumables: { [flacon.id]: 2, [box.id]: 2 },
    });
  });

  it('a builder set takes a 10 ml flacon per vial and no box; a parcel back from BTS returns them', async () => {
    const five = await slugsOf(t, 5);
    for (const s of five) await setConcentrateUl(t, s, 100_000);
    const flacon = await consumable(t, 'flacon', 10);
    const box = await consumable(t, 'box', 10);
    await setConsumable(t, flacon.id, 20);
    await setConsumable(t, box.id, 20);
    const buyer = await shopper(t, ali, '998901234567');
    expect((await buyer.cart.addBuilder({ body: { slugs: five, qty: 1 } })).status).toBe(200);
    const order = await placeOrder(t, buyer);
    await pay(t, order.number);
    await fulfilTo(t, order.number, 'handed_to_bts');
    expect((await onHandOf(flacon.id)).onHand).toBe(15);
    expect((await onHandOf(box.id)).onHand).toBe(20);
    for (const s of five) expect(await concentrateUl(t, s)).toBe(100_000 - FILL_UL[10]);

    const cancel = await manager.client.admin.orders.cancel({
      params: { number: order.number },
      body: { expectedStatus: 'handed_to_bts', reason: 'not_picked_up' },
    });
    expect(cancel.status).toBe(200);
    expect((await onHandOf(flacon.id)).onHand).toBe(20);
    for (const s of five) expect(await concentrateUl(t, s)).toBe(100_000);
  });

  it('an Uzum sale fills its bottle at once within available; its void puts it all back', async () => {
    const [a] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, a!);
    await stockBottles(t, id, 50, 1);
    const flacon = await consumable(t, 'flacon', 50);
    const box = await consumable(t, 'box', 50);
    await setConsumable(t, flacon.id, 2);
    await setConsumable(t, box.id, 2);
    const vol = await manager.client.admin.uzum.list({ query: { page: 1 } });
    if (vol.status !== 200) throw new Error('uzum list');
    const fifty = vol.body.items.find(
      (i) => i.kind === 'volume' && i.fragranceId === id && i.ml === 50,
    );
    expect(fifty).toMatchObject({ available: 1 });
    const volumeId = fifty!.kind === 'volume' ? fifty!.volumeId : 0;

    const two = await manager.client.admin.uzum.record({
      body: {
        soldOn: '2026-11-21',
        uzumOrder: 'UZ-1',
        lines: [{ kind: 'volume', volumeId, qty: 2, price: 249_000 }],
      },
    });
    expect(two.status).toBe(409);
    expect(two.status === 409 && two.body).toMatchObject({
      code: 'stock_short',
      short: [{ volumeId, wanted: 2, available: 1 }],
    });

    const one = await manager.client.admin.uzum.record({
      body: {
        soldOn: '2026-11-21',
        uzumOrder: 'UZ-1',
        lines: [{ kind: 'volume', volumeId, qty: 1, price: 249_000 }],
      },
    });
    expect(one.status).toBe(201);
    expect(await concentrateUl(t, id)).toBe(0);
    expect((await onHandOf(flacon.id)).onHand).toBe(1);
    expect((await onHandOf(box.id)).onHand).toBe(1);

    const voided = await manager.client.admin.uzum.void({
      params: { id: one.status === 201 ? one.body.id : 0 },
      body: { reason: 'Отменён покупателем' },
    });
    expect(voided.status).toBe(200);
    expect(await concentrateUl(t, id)).toBe(FILL_UL[50]);
    expect((await onHandOf(flacon.id)).onHand).toBe(2);
    expect((await onHandOf(box.id)).onHand).toBe(2);
    expect((await movesOf(id)).map((m) => [m.kind, m.concentrateUl])).toEqual([
      ['uzum_sale', -FILL_UL[50]],
      ['uzum_sale_voided', FILL_UL[50]],
    ]);
  });

  it('a first order’s gift sample is a 5 ml fill only when the order’s own bottles leave one', async () => {
    await t.db
      .update(settings)
      .set({ value: true })
      .where(eq(settings.key, 'giftSample.enabled'));
    const [a] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, a!);
    await t.db
      .insert(settings)
      .values({ key: 'giftSample.fragranceId', value: id })
      .onConflictDoUpdate({ target: settings.key, set: { value: id } });
    // one 10 ml fill and a little: no 5 ml is left once the order's bottle is held
    await setConcentrateUl(t, id, FILL_UL[10] + FILL_UL[5] - 1);
    const { order } = await orderOf(ali, '998901234567', [{ slug: a!, ml: 10, qty: 1 }]);
    const first = await t.signIn(ali);
    const mine = await first.client.orders.get({ params: { number: order.number } });
    expect(mine.status === 200 && mine.body.lines.some((l) => l.kind === 'volume' && l.ml === 5)).toBe(
      false,
    );

    // a whole 5 ml left over: the next first order gets it
    await setConcentrateUl(t, id, 2 * FILL_UL[10] + FILL_UL[5]);
    const { order: second } = await orderOf(vali, '998907654321', [
      { slug: a!, ml: 10, qty: 1 },
    ]);
    const other = await signedIn(t, vali);
    const theirs = await other.orders.get({ params: { number: second.number } });
    expect(
      theirs.status === 200 && theirs.body.lines.filter((l) => l.kind === 'volume').map((l) => l.ml),
    ).toEqual([10, 5]);
    expect((await orderRow(t, second.number)).status).toBe('awaiting_payment');
  });
});

describe('mixing makes ready concentrate from oil and ethanol', () => {
  it('takes the oil and the ethanol of the ml made, without the filling loss, or refuses', async () => {
    const [a] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, a!);
    await setConcentrateUl(t, id, 0);
    expect(
      (await owner.client.admin.warehouse.receiveOil({ params: { id }, body: RECEIPT })).status,
    ).toBe(201);
    const ethanol = await consumable(t, 'ethanol');
    await setConsumable(t, ethanol.id, 0);

    // no ethanol yet: 100 ml takes 70 ml
    const dry = await manager.client.admin.warehouse.mix({ params: { id }, body: { ml: 100 } });
    expect(dry.status).toBe(409);
    expect(dry.body).toMatchObject({ code: 'ethanol_short', neededMl: 70, balanceMl: 0, shortMl: 70 });

    const got = await manager.client.admin.consumables.receive({
      params: { id: ethanol.id },
      body: { quantity: 1000, note: 'Канистра' },
    });
    expect(got.status).toBe(201);
    const mixed = await manager.client.admin.warehouse.mix({ params: { id }, body: { ml: 100 } });
    expect(mixed.status).toBe(201);
    expect(mixed.body).toEqual({
      oilGrams: 30,
      ethanolMl: 70,
      oilLeftGrams: 70,
      concentrateMl: 100,
    });
    expect(await concentrateUl(t, id)).toBe(100_000);
    expect((await onHandOf(ethanol.id)).onHand).toBe(930);

    // 300 ml would take 90 g of oil: 70 g left, refused and nothing written
    const short = await manager.client.admin.warehouse.mix({ params: { id }, body: { ml: 300 } });
    expect(short.status).toBe(409);
    expect(short.body).toMatchObject({
      code: 'oil_short',
      neededGrams: 90,
      balanceGrams: 70,
      shortGrams: 20,
    });
    expect(await concentrateUl(t, id)).toBe(100_000);
    expect((await onHandOf(ethanol.id)).onHand).toBe(930);

    const mix = (await movesOf(id)).find((m) => m.kind === 'mixing');
    expect(mix).toMatchObject({
      oilMg: -30_000,
      concentrateUl: 100_000,
      consumables: { [ethanol.id]: -70 },
    });
    const page = await owner.client.admin.warehouse.get({ params: { id } });
    expect(page.status === 200 && page.body.history[0]).toMatchObject({
      kind: 'mixing',
      oilGrams: -30,
      concentrateMl: 100,
      consumables: [{ consumableId: ethanol.id, change: -70 }],
    });
  });
});

describe('a consumable shortfall never blocks', () => {
  it('the handover goes on; the counts stop at zero, the move says what was short, a count clears it', async () => {
    const [a] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, a!);
    await setConcentrateUl(t, id, 100_000);
    const flacon = await consumable(t, 'flacon', 10);
    const box = await consumable(t, 'box', 10);
    await setConsumable(t, flacon.id, 1);
    await setConsumable(t, box.id, 0);

    const { order } = await orderOf(ali, '998901234567', [{ slug: a!, ml: 10, qty: 2 }]);
    await pay(t, order.number);
    await fulfilTo(t, order.number, 'handed_to_bts');
    expect((await orderRow(t, order.number)).status).toBe('handed_to_bts');
    expect(await onHandOf(flacon.id)).toEqual({ onHand: 0, needsRecount: true });
    expect(await onHandOf(box.id)).toEqual({ onHand: 0, needsRecount: true });
    const sale = (await movesOf(id)).find((m) => m.kind === 'sale')!;
    expect(sale.consumables).toEqual({ [flacon.id]: -1 });
    expect(sale.details).toMatchObject({ short: { consumables: { [flacon.id]: 1, [box.id]: 2 } } });

    const list = await manager.client.admin.consumables.list();
    expect(
      list.status === 200 && list.body.items.find((i) => i.id === flacon.id),
    ).toMatchObject({ onHand: 0, needsRecount: true, level: 'zero' });

    const counted = await manager.client.admin.consumables.count({
      params: { id: flacon.id },
      body: { onHand: 40, expected: 0, reason: 'Пересчитали' },
    });
    expect(counted.status === 200 && counted.body).toMatchObject({ onHand: 40, needsRecount: false });
    const stale = await manager.client.admin.consumables.count({
      params: { id: flacon.id },
      body: { onHand: 41, expected: 0, reason: 'Пересчитали' },
    });
    expect(stale.status === 409 && stale.body).toEqual({ code: 'changed', current: 40 });
    const history = await manager.client.admin.consumables.history({ params: { id: flacon.id } });
    expect(history.status === 200 && history.body.moves.map((m) => m.kind)).toEqual([
      'consumable_corrected',
      'sale',
    ]);
  });
});

describe('the migration folds the bottles on hand into concentrate and consumables', () => {
  const drizzleDir = fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url));
  const LAST_BEFORE = '0041_uzum_sales';

  it('pours each fragrance’s bottles into its concentrate at the stored filling loss, flacons and boxes counted, one history line', async () => {
    const adminUrl = inject('pgAdminUrl');
    const dbName = `fold_${Date.now()}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
    const before = mkdtempSync(join(tmpdir(), 'lummi-drizzle-'));
    try {
      // the migrations up to #80's, as stage-1 had them
      cpSync(drizzleDir, before, { recursive: true });
      const journalPath = join(before, 'meta/_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string }[];
      };
      const cut = journal.entries.findIndex((e) => e.tag === LAST_BEFORE);
      expect(cut).toBeGreaterThan(0);
      journal.entries = journal.entries.slice(0, cut + 1);
      writeFileSync(journalPath, JSON.stringify(journal));
      await migrateDb(url.toString(), before);

      // a fragrance with bottles on hand, and a 5 % filling loss the owner set
      await pool.query(`INSERT INTO settings (key, value) VALUES ('cost.liquid.fillingLossPercent', '5'), ('stock.lowOilLitres', '2')`);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO fragrances (slug, code, name, original_brand, type, season, time_of_day,
           longevity_ru, longevity_uz, sillage, description_ru, description_uz, when_to_wear_ru,
           when_to_wear_uz, key_notes_ru, key_notes_uz)
         VALUES ('nuit', '901', 'Nuit', 'Maison', 'unisex', 'all_year', 'evening', 'до 24 часов',
           '24 soatgacha', 'strong', 'Тёплый', 'Iliq', 'Вечером', 'Kechqurun',
           ARRAY['a','b','c'], ARRAY['a','b','c']),
           ('empty', '902', 'Empty', 'Maison', 'unisex', 'all_year', 'evening', 'до 24 часов',
           '24 soatgacha', 'strong', 'Тёплый', 'Iliq', 'Вечером', 'Kechqurun',
           ARRAY['a','b','c'], ARRAY['a','b','c'])
         RETURNING id`,
      );
      const [nuit, empty] = rows.map((r) => Number(r.id));
      await pool.query(
        `INSERT INTO volumes (fragrance_id, ml, price, on_hand) VALUES
           ($1, 5, 0, 4), ($1, 10, 69000, 3), ($1, 30, 149000, 2), ($1, 50, 219000, 1),
           ($2, 5, 0, 0), ($2, 10, 69000, 0)`,
        [nuit, empty],
      );

      // then #82's migration
      await migrateDb(url.toString());

      const f = await pool.query<{ id: string; concentrate_ul: string }>(
        'SELECT id, concentrate_ul FROM fragrances ORDER BY id',
      );
      // 4 × 5.25 + 3 × 10.5 + 2 × 31.5 + 1 × 52.5 = 168 ml
      expect(f.rows.map((r) => Number(r.concentrate_ul))).toEqual([168_000, 0]);
      const c = await pool.query<{ use: string; ml: number | null; unit: string; on_hand: number }>(
        'SELECT use, ml, unit, on_hand FROM consumables ORDER BY id',
      );
      const seeded = await pool.query<{ name_ru: string; name_uz: string; low_threshold: number }>(
        'SELECT name_ru, name_uz, low_threshold FROM consumables ORDER BY id',
      );
      // the harness puts the same rows back after its truncate
      expect(
        seeded.rows.map((r, i) => ({
          nameRu: r.name_ru,
          nameUz: r.name_uz,
          lowThreshold: r.low_threshold,
          unit: c.rows[i]!.unit,
          use: c.rows[i]!.use,
          ml: c.rows[i]!.ml,
        })),
      ).toEqual(SEEDED_CONSUMABLES);
      expect(c.rows).toEqual([
        { use: 'flacon', ml: 5, unit: 'pcs', on_hand: 4 },
        { use: 'flacon', ml: 10, unit: 'pcs', on_hand: 3 },
        { use: 'flacon', ml: 30, unit: 'pcs', on_hand: 2 },
        { use: 'flacon', ml: 50, unit: 'pcs', on_hand: 1 },
        { use: 'box', ml: 10, unit: 'pcs', on_hand: 3 },
        { use: 'box', ml: 30, unit: 'pcs', on_hand: 2 },
        { use: 'box', ml: 50, unit: 'pcs', on_hand: 1 },
        { use: 'ethanol', ml: null, unit: 'ml', on_hand: 0 },
      ]);
      const ids = (
        await pool.query<{ id: string; use: string; ml: number | null }>(
          'SELECT id, use, ml FROM consumables ORDER BY id',
        )
      ).rows;
      const idOf = (use: string, ml: number) => ids.find((r) => r.use === use && r.ml === ml)!.id;
      const m = await pool.query<{
        fragrance_id: string;
        kind: string;
        concentrate_ul: string;
        bottles: Record<string, number>;
        consumables: Record<string, number>;
        details: Record<string, unknown>;
        actor_type: string;
      }>('SELECT * FROM stock_moves');
      expect(m.rows).toHaveLength(1);
      expect(m.rows[0]).toMatchObject({
        fragrance_id: String(nuit),
        kind: 'correction',
        bottles: { 5: -4, 10: -3, 30: -2, 50: -1 },
        consumables: {
          [idOf('flacon', 5)]: 4,
          [idOf('flacon', 10)]: 3,
          [idOf('flacon', 30)]: 2,
          [idOf('flacon', 50)]: 1,
          [idOf('box', 10)]: 3,
          [idOf('box', 30)]: 2,
          [idOf('box', 50)]: 1,
        },
        details: { source: 'migration' },
        actor_type: 'system',
      });
      expect(Number(m.rows[0]!.concentrate_ul)).toBe(168_000);
      // the bottle counts are gone, and so is the old low-oil setting (litres of perfume)
      const col = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'volumes' AND column_name = 'on_hand'`,
      );
      expect(col.rowCount).toBe(0);
      const old = await pool.query(`SELECT 1 FROM settings WHERE key = 'stock.lowOilLitres'`);
      expect(old.rowCount).toBe(0);
    } finally {
      await pool.end();
      rmSync(before, { recursive: true, force: true });
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    }
  });
});
