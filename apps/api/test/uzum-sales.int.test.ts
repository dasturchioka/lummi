import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UzumSaleInput, WarehouseFragrance } from '@lummi/contracts';
import {
  and,
  auditLog,
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  settings,
  uzumSales,
  volumes,
} from '@lummi/db';
import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { reservedByVolume } from '../src/catalog/catalog.service';
import { fulfilTo, orderRow, pay, placeOrder, tashkent } from './harness/fulfilment';
import { orderBody, samarkandPoint, shopper, slugs, untilWaitingOnLocks } from './harness/orders';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): Uzum sales (#80) over HTTP. A sale takes its bottles off on hand at once and
 * freezes its profit on the Uzum channel: the commission, no mailer, no delivery. The expected
 * profits are the customer's calculator's own (`single(scent, volume, 'uzum')` at its defaults:
 * commission 20.5 %, ad 3 000, tax 1 %) for the made-up oil prices below, or worked out by hand
 * from its unit costs (A 10 ml 22 462, A 30 ml 52 086, B 10 ml 17 145).
 */
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

const OIL_A = 3950;
const OIL_B = 2150;
const PRICES: Record<number, number> = { 10: 69_000, 30: 189_000, 50: 249_000 };
const ali: TestUser = { id: 8001, first_name: 'Ali', language_code: 'ru' };

let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
type Picked = { slug: string; id: number; name: string; vol: Record<number, number> };
/** A and B carry oil prices; C has none. Every volume: 20 on hand at the calculator's prices. */
let A: Picked;
let B: Picked;
let C: Picked;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(tashkent('2026-11-19 10:00'));
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  manager = await t.managerSession();
  const picked: Picked[] = [];
  for (const slug of await slugs(t, 3)) {
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, slug));
    const vol: Record<number, number> = {};
    for (const ml of [10, 30, 50]) {
      const [v] = await t.db
        .update(volumes)
        .set({ price: PRICES[ml]!, salePrice: null, saleEndsAt: null, onHand: 20 })
        .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, ml)))
        .returning({ id: volumes.id });
      vol[ml] = v!.id;
    }
    picked.push({ slug, id: f!.id, name: f!.name, vol });
  }
  [A, B, C] = picked as [Picked, Picked, Picked];
  await t.db.update(fragrances).set({ oilPrice: OIL_A }).where(eq(fragrances.id, A.id));
  await t.db.update(fragrances).set({ oilPrice: OIL_B }).where(eq(fragrances.id, B.id));
  await t.db.update(fragrances).set({ oilPrice: null }).where(eq(fragrances.id, C.id));
});

const sale = (over: Partial<UzumSaleInput> = {}): UzumSaleInput => ({
  soldOn: '2026-11-18',
  uzumOrder: 'UZ-1001',
  lines: [{ kind: 'volume', volumeId: A.vol[10]!, qty: 1, price: 69_000 }],
  ...over,
});
const record = (body: UzumSaleInput, as: StaffSession = manager) =>
  as.client.admin.uzum.record({ body });
async function recorded(body: UzumSaleInput, as: StaffSession = manager) {
  const res = await record(body, as);
  if (res.status !== 201) throw new Error(`uzum sale ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const voidSale = (id: number, reason = 'Покупатель отменил', as: StaffSession = manager) =>
  as.client.admin.uzum.void({ params: { id }, body: { reason } });
async function page(id: number): Promise<WarehouseFragrance> {
  const res = await owner.client.admin.warehouse.get({ params: { id } });
  if (res.status !== 200) throw new Error(`warehouse ${res.status}`);
  return res.body;
}
const onHand = async (volumeId: number) =>
  (await t.db.select().from(volumes).where(eq(volumes.id, volumeId)))[0]!.onHand;
const setOnHand = async (vialMl: number) =>
  (await t.db.select().from(discoverySet).where(eq(discoverySet.vialMl, vialMl)))[0]!.onHand;
const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));

describe('recording an Uzum sale', () => {
  it('lowers on hand at once, lists it in the fragrance history and audits it', async () => {
    const res = await record(
      sale({ lines: [{ kind: 'volume', volumeId: A.vol[10]!, qty: 2, price: 69_000 }] }),
    );
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body).toMatchObject({
      soldOn: '2026-11-18',
      uzumOrder: 'UZ-1001',
      commissionPercent: 20.5,
      units: 2,
      revenue: 138_000,
      source: 'form',
      voided: false,
      // a manager records sales but never sees costs
      costs: null,
    });
    expect(res.body.lines[0]).toMatchObject({ name: A.name, ml: 10, qty: 2, unitCost: null });
    expect(await onHand(A.vol[10]!)).toBe(18);

    const history = (await page(A.id)).history;
    expect(history[0]).toMatchObject({
      kind: 'uzum_sale',
      bottles: [{ ml: 10, change: -2 }],
      uzumOrder: 'UZ-1001',
      actorName: manager.staff.name,
    });
    const [entry] = await audits('uzum.sale_recorded');
    expect(entry).toMatchObject({ actorType: 'staff', actorId: manager.staff.id });
    expect(entry!.payload).toMatchObject({ uzumOrder: 'UZ-1001', revenue: 138_000, via: 'form' });
  });

  it("freezes the sale's profit on the Uzum channel, as the calculator counts it", async () => {
    const one = await recorded(sale(), owner);
    // the calculator's A 10 ml on Uzum: 69 000 − 22 462 − 14 145 − 3 000 − 690
    expect(one.costs?.profit).toMatchObject({
      channel: 'uzum',
      revenue: 69_000,
      goods: 22_462,
      mailer: 0,
      btsCharge: 0,
      deliveryPaid: 0,
      commissionPercent: 20.5,
      commission: 14_145,
      adPerSale: 3_000,
      tax: 690,
      profit: 28_703,
    });
    expect(one.lines[0]!.unitCost).toBe(22_462);

    // one sale, one ad: 258 000 − (52 086 + 17 145) − 52 890 − 3 000 − 2 580
    const two = await recorded(
      sale({
        uzumOrder: 'UZ-1002',
        lines: [
          { kind: 'volume', volumeId: A.vol[30]!, qty: 1, price: 189_000 },
          { kind: 'volume', volumeId: B.vol[10]!, qty: 1, price: 69_000 },
        ],
      }),
      owner,
    );
    expect(two.costs?.profit).toMatchObject({ revenue: 258_000, goods: 69_231, profit: 130_299 });

    // the sale's own commission, not the setting's
    const own = await recorded(sale({ uzumOrder: 'UZ-1003', commissionPercent: 15 }), owner);
    // 69 000 − 22 462 − 10 350 − 3 000 − 690
    expect(own.costs?.profit).toMatchObject({ commissionPercent: 15, profit: 32_498 });
  });

  it('has no profit without an oil price, and names the fragrance', async () => {
    const res = await recorded(
      sale({ lines: [{ kind: 'volume', volumeId: C.vol[10]!, qty: 1, price: 69_000 }] }),
      owner,
    );
    expect(res.costs).toMatchObject({ profit: null, missing: [C.name] });
    expect(await onHand(C.vol[10]!)).toBe(19);
  });

  it('sells either Discovery set from its own stock, picked by its vial ml', async () => {
    await t.db.update(discoverySet).set({ onHand: 3 });
    const res = await recorded(
      sale({
        lines: [
          { kind: 'discovery_set', vialMl: 10, qty: 1, price: 299_000 },
          { kind: 'discovery_set', vialMl: 5, qty: 2, price: 99_000 },
        ],
      }),
    );
    expect(res).toMatchObject({ units: 3, revenue: 497_000 });
    expect(res.lines.map((l) => [l.kind, l.name, l.ml, l.qty])).toEqual([
      ['discovery_set', null, 10, 1],
      ['discovery_set', null, 5, 2],
    ]);
    expect([await setOnHand(10), await setOnHand(5)]).toEqual([2, 1]);

    // the void brings each set's boxes back to its own row
    await voidSale(res.id);
    expect([await setOnHand(10), await setOnHand(5)]).toEqual([3, 3]);
  });

  it('never sells a 5 ml bottle alone, and does not offer one', async () => {
    const [five] = await t.db
      .update(volumes)
      .set({ onHand: 20 })
      .where(and(eq(volumes.fragranceId, A.id), eq(volumes.ml, 5)))
      .returning({ id: volumes.id });
    const res = await record(
      sale({ lines: [{ kind: 'volume', volumeId: five!.id, qty: 1, price: 30_000 }] }),
    );
    expect(res.status).toBe(422);
    expect(res.status === 422 && res.body).toEqual({
      code: 'invalid',
      fields: ['lines.0.volumeId'],
    });
    expect(await onHand(five!.id)).toBe(20);
    const list = await manager.client.admin.uzum.list({ query: {} });
    expect(
      list.status === 200 && list.body.items.some((i) => i.kind === 'volume' && i.ml === 5),
    ).toBe(false);
  });

  it('judges a Discovery set through its one read: short of its five, none is available', async () => {
    await t.db.update(discoverySet).set({ onHand: 3 });
    await t.db
      .delete(discoverySetItems)
      .where(and(eq(discoverySetItems.vialMl, 5), eq(discoverySetItems.position, 1)));

    const list = await manager.client.admin.uzum.list({ query: {} });
    const sets =
      list.status === 200 ? list.body.items.filter((i) => i.kind === 'discovery_set') : [];
    expect(sets).toEqual([
      { kind: 'discovery_set', vialMl: 10, available: 3 },
      { kind: 'discovery_set', vialMl: 5, available: 0 },
    ]);
    const res = await record(
      sale({ lines: [{ kind: 'discovery_set', vialMl: 5, qty: 1, price: 99_000 }] }),
    );
    expect(res.status).toBe(409);
    expect(res.status === 409 && res.body.short).toEqual([
      { kind: 'discovery_set', volumeId: null, name: null, ml: 5, wanted: 1, available: 0 },
    ]);
    expect(await setOnHand(5)).toBe(3);
  });

  it('freezes the commission as the row keeps it, to two decimals', async () => {
    await t.db.insert(settings).values({ key: 'cost.order.uzumCommissionPercent', value: 20.555 });
    const res = await recorded(sale(), owner);
    expect(res.commissionPercent).toBe(20.56);
    // 69 000 × 20.56 % = 14 186.4
    expect(res.costs?.profit).toMatchObject({ commissionPercent: 20.56, commission: 14_186 });
    const [row] = await t.db.select().from(uzumSales).where(eq(uzumSales.id, res.id));
    expect(row!.commissionPercent).toBe(20.56);
  });

  it('refuses more than is available (on hand less the reserve) and writes nothing', async () => {
    await t.db.update(volumes).set({ onHand: 2 }).where(eq(volumes.id, A.vol[10]!));
    // an order holds one of the two
    const client = await shopper(t, ali, '998901112233');
    await client.cart.addLine({ body: { slug: A.slug, ml: 10, qty: 1 } });
    await placeOrder(t, client);

    const res = await record(
      sale({
        lines: [
          { kind: 'volume', volumeId: A.vol[10]!, qty: 2, price: 69_000 },
          { kind: 'volume', volumeId: B.vol[10]!, qty: 1, price: 69_000 },
        ],
      }),
    );
    expect(res.status).toBe(409);
    expect(res.status === 409 && res.body).toEqual({
      code: 'stock_short',
      short: [
        { kind: 'volume', volumeId: A.vol[10]!, name: A.name, ml: 10, wanted: 2, available: 1 },
      ],
    });
    expect(await onHand(A.vol[10]!)).toBe(2);
    expect(await onHand(B.vol[10]!)).toBe(20);
    expect(await audits('uzum.sale_recorded')).toHaveLength(0);
    // one is still available
    const ok = await record(
      sale({ lines: [{ kind: 'volume', volumeId: A.vol[10]!, qty: 1, price: 69_000 }] }),
    );
    expect(ok.status).toBe(201);
  });

  it('keeps one standing sale per Uzum order number', async () => {
    const first = await recorded(sale());
    const again = await record(sale());
    expect(again.status).toBe(409);
    expect(again.status === 409 && again.body.code).toBe('duplicate_order');
    expect(await onHand(A.vol[10]!)).toBe(19);
    // a voided one can be typed again
    await voidSale(first.id);
    expect((await record(sale())).status).toBe(201);
  });

  it('refuses a volume that does not exist', async () => {
    const res = await record(
      sale({ lines: [{ kind: 'volume', volumeId: 999_999, qty: 1, price: 69_000 }] }),
    );
    expect(res.status).toBe(422);
    expect(res.status === 422 && res.body).toEqual({
      code: 'invalid',
      fields: ['lines.0.volumeId'],
    });
  });
});

describe('voiding an Uzum sale', () => {
  it('brings the bottles back, keeps the sale with its reason, and audits it', async () => {
    const s = await recorded(
      sale({ lines: [{ kind: 'volume', volumeId: A.vol[30]!, qty: 3, price: 189_000 }] }),
    );
    expect(await onHand(A.vol[30]!)).toBe(17);

    const res = await voidSale(s.id, 'Возврат на Uzum');
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body).toMatchObject({
      voided: true,
      voidReason: 'Возврат на Uzum',
      voidedByName: manager.staff.name,
    });
    expect(await onHand(A.vol[30]!)).toBe(20);
    expect((await page(A.id)).history[0]).toMatchObject({
      kind: 'uzum_sale_voided',
      bottles: [{ ml: 30, change: 3 }],
      reason: 'Возврат на Uzum',
      uzumOrder: 'UZ-1001',
    });
    const [entry] = await audits('uzum.sale_voided');
    expect(entry!.payload).toMatchObject({ uzumOrder: 'UZ-1001', reason: 'Возврат на Uzum' });

    const twice = await voidSale(s.id);
    expect(twice.status).toBe(409);
    expect(twice.status === 409 && twice.body.code).toBe('voided');
    expect(await onHand(A.vol[30]!)).toBe(20);
    expect((await voidSale(999_999)).status).toBe(404);
  });

  it("brings the Discovery set's boxes back to its own stock", async () => {
    await t.db.update(discoverySet).set({ onHand: 3 });
    const s = await recorded(
      sale({ lines: [{ kind: 'discovery_set', vialMl: 10, qty: 2, price: 299_000 }] }),
    );
    expect(await setOnHand(10)).toBe(1);
    await voidSale(s.id);
    expect(await setOnHand(10)).toBe(3);
  });
});

describe('an Uzum sale and a Mini App order at once', () => {
  /**
   * Both requests line up behind a lock on the bottle's row, `first` ahead of `second` (waiters on
   * a row are let through in the order they came), then race for the last bottle.
   */
  async function queued<A, B>(first: () => Promise<A>, second: () => Promise<B>) {
    const locker = new pg.Client({ connectionString: t.env.DATABASE_URL });
    await locker.connect();
    try {
      await locker.query('begin');
      await locker.query('select 1 from volumes where id = $1 for update', [A.vol[10]!]);
      const a = first();
      await untilWaitingOnLocks(locker, 1);
      const b = second();
      await untilWaitingOnLocks(locker, 2);
      await locker.query('commit');
      return [await a, await b] as const;
    } finally {
      await locker.end();
    }
  }

  async function lastBottle() {
    await t.db.update(volumes).set({ onHand: 1 }).where(eq(volumes.id, A.vol[10]!));
    const client = await shopper(t, ali, '998901112233');
    await client.cart.addLine({ body: { slug: A.slug, ml: 10, qty: 1 } });
    const point = await samarkandPoint(t);
    const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
    if (checkout.status !== 200) throw new Error('checkout');
    return () => client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
  }

  /** Nothing overdrawn: on hand covers what open orders reserve, to the bottle. */
  async function expectNoOverdraw(left: number) {
    const reserved = (await reservedByVolume(t.db, [A.vol[10]!])).get(A.vol[10]!) ?? 0;
    expect(await onHand(A.vol[10]!)).toBe(left);
    expect(left - reserved).toBe(0);
  }

  it('refuses the sale when the order took the last bottle first', async () => {
    const order = await lastBottle();
    const [placed, sold] = await queued(order, () => record(sale()));
    expect(placed.status).toBe(201);
    expect(sold.status).toBe(409);
    expect(sold.status === 409 && sold.body.code).toBe('stock_short');
    await expectNoOverdraw(1);
  });

  it('leaves the order nothing when the sale took the last bottle first', async () => {
    const order = await lastBottle();
    const [sold, placed] = await queued(() => record(sale()), order);
    expect(sold.status).toBe(201);
    expect(placed.status).not.toBe(201);
    await expectNoOverdraw(0);
  });
});

describe('the sales report', () => {
  it('splits revenue and profit by channel, a voided Uzum sale left out', async () => {
    // the Mini App: one A 10 ml delivered on 19 November (69 000 + 25 000 delivery)
    const client = await shopper(t, ali, '998901112233');
    await client.cart.addLine({ body: { slug: A.slug, ml: 10, qty: 1 } });
    const o = await placeOrder(t, client);
    await pay(t, o.number);
    await fulfilTo(t, o.number, 'delivered');
    const miniapp = (await orderRow(t, o.number)).costs!.profit!;

    // Uzum: one A 10 ml and one with no oil price; a voided one; one outside the range
    await recorded(sale({ uzumOrder: 'UZ-1', soldOn: '2026-11-18' }));
    await recorded(
      sale({
        uzumOrder: 'UZ-2',
        soldOn: '2026-11-19',
        lines: [{ kind: 'volume', volumeId: C.vol[10]!, qty: 1, price: 70_000 }],
      }),
    );
    const voided = await recorded(sale({ uzumOrder: 'UZ-3', soldOn: '2026-11-19' }));
    await voidSale(voided.id);
    await recorded(sale({ uzumOrder: 'UZ-4', soldOn: '2026-11-01' }));

    const res = await owner.client.admin.reports.sales({
      query: { from: '2026-11-10', to: '2026-11-19' },
    });
    if (res.status !== 200) throw new Error(`report ${res.status}`);
    const { channels, profit } = res.body;
    const { orders, ...rest } = profit;
    expect(channels.miniapp).toEqual({
      sales: 1,
      revenue: 69_000,
      commission: 0,
      profit: { sales: orders, ...rest },
    });
    expect(profit).toMatchObject({ orders: 1, revenue: 69_000, profit: miniapp.profit });
    expect(channels.uzum).toEqual({
      sales: 2,
      revenue: 139_000,
      commission: 14_145,
      profit: {
        sales: 1,
        uncosted: 1,
        revenue: 69_000,
        cost: 69_000 - 28_703,
        profit: 28_703,
        margin: 28_703 / 69_000,
      },
    });
    expect(channels.total).toEqual({
      sales: 3,
      revenue: 208_000,
      commission: 14_145,
      profit: {
        sales: 2,
        uncosted: 1,
        revenue: 138_000,
        cost: 138_000 - miniapp.profit - 28_703,
        profit: miniapp.profit + 28_703,
        margin: (miniapp.profit + 28_703) / 138_000,
      },
    });

    // the Excel's «Каналы»: channel, sales, revenue … profit
    const file = await fetch(
      `${t.baseUrl}/admin/reports/sales/export?from=2026-11-10&to=2026-11-19&lang=ru`,
      { headers: { cookie: owner.cookie } },
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
    const rows = wb.getWorksheet('Каналы')!.getSheetValues().slice(2) as unknown[][];
    expect(rows.map((r) => [r[1], r[2], r[3], r[9]])).toEqual([
      ['Мини-приложение', 1, 69_000, miniapp.profit],
      ['Uzum', 2, 139_000, 28_703],
      ['Всего', 3, 208_000, miniapp.profit + 28_703],
    ]);
  });
});

describe('who sees what', () => {
  it('gives the manager the list without costs and the owner with them; what the form can sell', async () => {
    await recorded(sale());
    const m = await manager.client.admin.uzum.list({ query: {} });
    expect(m.status).toBe(200);
    if (m.status !== 200) return;
    expect(m.body).toMatchObject({ total: 1, page: 1, commissionPercent: 20.5 });
    expect(m.body.sales[0]).toMatchObject({
      uzumOrder: 'UZ-1001',
      costs: null,
      actorName: manager.staff.name,
    });
    expect(m.body.items).toContainEqual(
      expect.objectContaining({
        kind: 'volume',
        volumeId: A.vol[10]!,
        name: A.name,
        ml: 10,
        available: 19,
      }),
    );
    expect(m.body.items).toContainEqual(expect.objectContaining({ kind: 'discovery_set' }));

    const o = await owner.client.admin.uzum.list({ query: {} });
    expect(o.status === 200 && o.body.sales[0]!.costs?.profit?.profit).toBe(28_703);
  });
});
