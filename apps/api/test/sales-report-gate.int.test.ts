import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  MarketingFigures,
  MarketingReport,
  MarketingReportQuery,
  SalesReport,
} from '@lummi/contracts';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import {
  BLOGGER_FILTER,
  EXPECTED_ACQUISITION,
  EXPECTED_DAYS,
  EXPECTED_FRAGRANCES,
  EXPECTED_PROMO_CODES,
  EXPECTED_SETS,
  EXPECTED_SOURCES,
  EXPECTED_TOTALS,
  EXPECTED_UPGRADE_RIGHTS,
  EXPECTED_VOLUMES,
  EXPECTED_EARLIER_CUSTOMERS,
  EXPECTED_WITHOUT_FIRST_LINK,
  EXPECTED_WITHOUT_LINK,
  NO_CODE_FILTER,
  placeTwentyOrders,
  RANGE,
  type FixtureCatalog,
  type LinkKey,
} from './fixtures/sales-report-orders';
import { returnWhole } from './harness/fulfilment';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * The TZ §10 acceptance gate (ADR 0028): «цифры отчёта совпадают с ручным расчётом» over 20 test
 * orders. The orders go through the real doors (checkout, payment, fulfilment, cancel, return,
 * refund); the expected figures are the hand calculation in `fixtures/sales-report-orders.ts`.
 * Any mismatch fails CI. The marketing reports (#43) are checked over the same orders, with the
 * fixture's campaign link opens.
 */

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let catalog: FixtureCatalog;
let numberOf: (n: number) => number;
let owner: StaffSession;

beforeAll(async () => {
  t = await createTestApp();
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
  ({ catalog, numberOf } = await placeTwentyOrders(t));
  owner = await t.ownerSession();
}, 300_000);
afterAll(() => t?.close());

async function report(query: { from: string; to: string }): Promise<SalesReport> {
  const res = await owner.client.admin.reports.sales({ query });
  if (res.status !== 200) throw new Error(`report ${res.status}`);
  return res.body;
}

describe('the 20-order report gate (TZ §10)', () => {
  it('matches the hand calculation day by day and over the range', async () => {
    const r = await report(RANGE);
    expect(r.days).toEqual(EXPECTED_DAYS);
    expect(r.totals).toEqual(EXPECTED_TOTALS);
  });

  it('matches it for the top fragrances, Volumes and sets', async () => {
    const r = await report(RANGE);
    expect(
      r.fragrances.map(({ fragranceId, units, net }) => ({ fragranceId, units, net })),
    ).toEqual(
      EXPECTED_FRAGRANCES.map(({ f, units, net }) => ({
        fragranceId: catalog.fragranceId[f],
        units,
        net,
      })),
    );
    expect(
      r.volumes.map(({ volumeId, fragranceId, ml, units, net }) => ({
        volumeId,
        fragranceId,
        ml,
        units,
        net,
      })),
    ).toEqual(
      EXPECTED_VOLUMES.map(({ f, ml, units, net }) => ({
        volumeId: catalog.volumeId[`${f}${ml}`],
        fragranceId: catalog.fragranceId[f],
        ml,
        units,
        net,
      })),
    );
    expect(r.sets.map(({ kind, units, net }) => ({ kind, units, net }))).toEqual(EXPECTED_SETS);
  });

  it('counts an order on its delivery day, so the days around the range hold the rest', async () => {
    // order 1 (delivered 9 Nov): C30 120 000 + B10 60 000, delivery 25 000; its refund is 11 Nov,
    // and order 2's refund sent on 9 Nov counts on 10 Nov, when 2 was delivered
    expect((await report({ from: '2026-11-09', to: '2026-11-09' })).totals).toEqual({
      orders: 1,
      itemsBeforeDiscount: 180_000,
      discount: 0,
      delivery: 25_000,
      refunds: 0,
      net: 180_000,
      averageCheck: 180_000,
    });
    // order 19 (delivered 15 Nov): C10 50 000, delivery 25 000; order 5's refund of 20 000 sent
    // 15 Nov (5 was delivered 10 Nov): net 50 000 − 20 000; the average leaves refunds out
    expect((await report({ from: '2026-11-15', to: '2026-11-15' })).totals).toEqual({
      orders: 1,
      itemsBeforeDiscount: 50_000,
      discount: 0,
      delivery: 25_000,
      refunds: 20_000,
      net: 30_000,
      averageCheck: 50_000,
    });
  });

  it('exports the same figures to Excel', async () => {
    const res = await fetch(
      `${t.baseUrl}/admin/reports/sales/export?from=${RANGE.from}&to=${RANGE.to}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const [days, fragrances, volumes, sets] = wb.worksheets;
    // the last sheet is profit (#77): these orders have no cost snapshot (no oil prices)
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'По дням',
      'Ароматы',
      'Объёмы',
      'Наборы',
      'Прибыль',
    ]);
    const rows = (ws: ExcelJS.Worksheet) =>
      ws
        .getSheetValues()
        .slice(2)
        .map((row) => (row as unknown[]).slice(1));
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    const figures = (e: (typeof EXPECTED_DAYS)[number] | typeof EXPECTED_TOTALS) => [
      e.orders,
      e.itemsBeforeDiscount,
      e.discount,
      e.delivery,
      e.refunds,
      e.net,
      e.averageCheck ?? '',
    ];
    expect(days!.getRow(1).values).toEqual([
      undefined,
      'День',
      'Заказов',
      'Товары до скидки',
      'Скидки',
      'Доставка',
      'Возвраты денег',
      'Чистые продажи',
      'Средний чек',
    ]);
    expect(rows(days!)).toEqual([
      ...EXPECTED_DAYS.map((e) => [day(e.day), ...figures(e)]),
      ['Итого', ...figures(EXPECTED_TOTALS)],
    ]);
    // cost and profit stay blank without a cost snapshot (#77)
    expect(rows(fragrances!).map((r) => r.slice(2))).toEqual(
      EXPECTED_FRAGRANCES.map((e) => [e.units, e.net, '', '']),
    );
    expect(rows(volumes!).map((r) => r.slice(2))).toEqual(
      EXPECTED_VOLUMES.map((e) => [e.ml, e.units, e.net, '', '']),
    );
    expect(rows(sets!)).toEqual([
      ['Discovery set', 2, 557_143, '', ''],
      ['Свой набор', 3, 840_000, '', ''],
    ]);
  });

  it('writes the Excel headers in Uzbek when asked', async () => {
    const res = await fetch(
      `${t.baseUrl}/admin/reports/sales/export?from=${RANGE.from}&to=${RANGE.to}&lang=uz`,
      { headers: { cookie: owner.cookie } },
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Kunlar boʻyicha',
      'Atirlar',
      'Hajmlar',
      'Toʻplamlar',
      'Foyda',
    ]);
    expect(wb.worksheets[0]!.getRow(1).getCell(7).value).toBe('Sof savdo');
  });
});

async function marketing(query: MarketingReportQuery): Promise<MarketingReport> {
  const res = await owner.client.admin.reports.marketing({ query });
  if (res.status !== 200) throw new Error(`marketing report ${res.status}`);
  return res.body;
}

/** The figures of a row, without what names it. */
const figuresOf = (r: MarketingFigures): MarketingFigures => ({
  orders: r.orders,
  customers: r.customers,
  firstTimeBuyers: r.firstTimeBuyers,
  itemsBeforeDiscount: r.itemsBeforeDiscount,
  discount: r.discount,
  refunds: r.refunds,
  net: r.net,
  averageCheck: r.averageCheck,
});

describe('the marketing reports over the same 20 orders (#43)', () => {
  const code = (key: LinkKey) => catalog.link[key].code;

  it('splits them by promo code, with opens and conversion through its links', async () => {
    const r = await marketing(RANGE);
    expect(
      r.promoCodes.map((p) => ({
        code: p.code,
        links: p.links.map((l) => l.code),
        ...figuresOf(p),
        opens: p.opens,
        linkOrders: p.linkOrders,
        conversion: p.conversion,
      })),
    ).toEqual(EXPECTED_PROMO_CODES.map((e) => ({ ...e, links: e.links.map(code) })));
    expect(r.promoCodes[0]!.promoCodeId).toBe(catalog.promoCodeId.BLOGER10);
  });

  it("splits them by the Source of the order's campaign link, the rest without a link", async () => {
    const r = await marketing(RANGE);
    expect(
      r.sources.map((s) => ({
        source: s.source,
        ...figuresOf(s),
        opens: s.opens,
        conversion: s.conversion,
        links: s.links.map((l) => ({
          code: l.link.code,
          ...figuresOf(l),
          opens: l.opens,
          conversion: l.conversion,
        })),
      })),
    ).toEqual(
      EXPECTED_SOURCES.map(({ link, ...e }) => ({
        ...e,
        // each Source has one link in the fixture: its row is the Source's figures
        links: link
          ? [{ code: code(link), ...figuresOf(e), opens: e.opens, conversion: e.conversion }]
          : [],
      })),
    );
    expect(r.withoutLink).toEqual(EXPECTED_WITHOUT_LINK);
  });

  it('splits them by the link that acquired the customer, earlier customers apart', async () => {
    const r = await marketing(RANGE);
    expect(
      r.acquisition.map((a) => ({
        source: a.source,
        acquired: a.acquired,
        ...figuresOf(a),
        links: a.links.map((l) => ({ code: l.link.code, acquired: l.acquired, ...figuresOf(l) })),
      })),
    ).toEqual(
      EXPECTED_ACQUISITION.map(({ link, ...e }) => ({
        ...e,
        links: link ? [{ code: code(link), acquired: e.acquired, ...figuresOf(e) }] : [],
      })),
    );
    expect(r.earlierCustomers).toEqual(EXPECTED_EARLIER_CUSTOMERS);
    expect(r.withoutFirstLink).toEqual(EXPECTED_WITHOUT_FIRST_LINK);
  });

  it('counts the set discount: rights issued, used, and the orders that used them', async () => {
    const r = await marketing(RANGE);
    expect(r.upgradeRights).toEqual(EXPECTED_UPGRADE_RIGHTS);
  });

  it('agrees with the sales report: the Sources and the acquisition each add up to it', async () => {
    const sales = (await report(RANGE)).totals;
    expectSplitsAddUpTo(await marketing(RANGE), {
      orders: sales.orders,
      itemsBeforeDiscount: sales.itemsBeforeDiscount,
      discount: sales.discount,
      refunds: sales.refunds,
      net: sales.net,
    });
  });

  it('narrows every table to a Source: opens and acquisitions on its links only', async () => {
    const r = await marketing({ ...RANGE, source: 'blogger' });
    expect(r.filters).toEqual({ source: 'blogger', code: null });
    expect(
      r.promoCodes.map((p) => ({
        code: p.code,
        links: p.links.map((l) => l.code),
        ...figuresOf(p),
        opens: p.opens,
        linkOrders: p.linkOrders,
        conversion: p.conversion,
      })),
    ).toEqual(BLOGGER_FILTER.promoCodes.map((e) => ({ ...e, links: e.links.map(code) })));
    // the blogger row as unfiltered, and nothing else
    const blogger = EXPECTED_SOURCES.find((e) => e.source === 'blogger')!;
    expect(
      r.sources.map((s) => ({
        source: s.source,
        ...figuresOf(s),
        opens: s.opens,
        conversion: s.conversion,
      })),
    ).toEqual([
      {
        source: 'blogger',
        ...figuresOf(blogger),
        opens: blogger.opens,
        conversion: blogger.conversion,
      },
    ]);
    expect(r.withoutLink).toEqual(NO_SALES);
    const promoCode = r.acquisition.find((a) => a.source === 'promo_code')!;
    expect({ acquired: promoCode.acquired, ...figuresOf(promoCode) }).toEqual(
      BLOGGER_FILTER.acquisitionPromoCode,
    );
    expect(
      r.acquisition.filter((a) => a.source !== 'promo_code').map((a) => a.orders + a.acquired),
    ).toEqual([0, 0, 0, 0, 0]);
    expect(r.earlierCustomers).toEqual(BLOGGER_FILTER.earlierCustomers);
    expect(r.withoutFirstLink).toEqual(NO_SALES);
    expect(r.upgradeRights.map((u) => [u.source, u.issued, u.orders])).toEqual([
      ['set', BLOGGER_FILTER.setRightsIssued, 0],
      ['single_10ml', 0, 0],
    ]);
    expectSplitsAddUpTo(r, BLOGGER_FILTER.totals);
  });

  it('narrows every table to the orders without a promo code', async () => {
    const r = await marketing({ ...RANGE, code: 'none' });
    expect(r.filters).toEqual({ source: null, code: 'none' });
    expect(r.promoCodes).toEqual([]);
    const row = (source: string) => {
      const s = r.sources.find((x) => x.source === source)!;
      return { ...figuresOf(s), opens: s.opens, conversion: s.conversion };
    };
    // instagram, the channel and the store QR took no code: as unfiltered
    for (const e of EXPECTED_SOURCES.filter((x) =>
      ['instagram', 'telegram_channel', 'store_qr', 'other'].includes(x.source),
    ))
      expect(row(e.source)).toEqual({ ...figuresOf(e), opens: e.opens, conversion: e.conversion });
    expect(row('blogger')).toEqual(NO_CODE_FILTER.blogger);
    expect(row('promo_code')).toEqual(NO_CODE_FILTER.promoCode);
    expect(r.withoutLink).toEqual(NO_CODE_FILTER.withoutLink);
    expectSplitsAddUpTo(r, NO_CODE_FILTER.totals);
  });

  it('narrows to one promo code, whatever case the URL has', async () => {
    const r = await marketing({ ...RANGE, code: 'bloger10' });
    expect(r.filters.code).toBe('BLOGER10');
    expect(r.promoCodes.map((p) => [p.code, p.orders, p.net, p.opens, p.conversion])).toEqual([
      ['BLOGER10', 3, 1_170_900, 4, 75],
    ]);
    // 8, 14, 17 all came through a link; 1 170 900 + their discount 119 000 = 1 289 900 of items
    expect(r.withoutLink).toEqual(NO_SALES);
    expectSplitsAddUpTo(r, {
      orders: 3,
      itemsBeforeDiscount: 1_289_900,
      discount: 119_000,
      refunds: 0,
      net: 1_170_900,
    });
  });

  it('refuses a filter it does not know, on the page and in the export', async () => {
    const res = await owner.client.admin.reports.marketing({
      query: { ...RANGE, source: 'tiktok' as 'blogger' },
    });
    expect(res.status).toBe(400);
    const file = await fetch(
      `${t.baseUrl}/admin/reports/marketing/export?from=${RANGE.from}&to=${RANGE.to}&code=%21%21`,
      { headers: { cookie: owner.cookie } },
    );
    expect(file.status).toBe(422);
  });

  it('counts a single day: opens, orders and conversion of that day only', async () => {
    // 14 Nov: BLOGER10's order 17 (through malika); bobur opened malika that day, nobody else
    // opened one of its links: conversion 1 ÷ 1. MINUS50 had nothing that day.
    const r = await marketing({ from: '2026-11-14', to: '2026-11-14' });
    expect(
      r.promoCodes.map((p) => [p.code, p.orders, p.net, p.opens, p.linkOrders, p.conversion]),
    ).toEqual([['BLOGER10', 1, 333_900, 1, 1, 100]]);

    // 11 Nov: no delivery; dilnoza opened BLOGER10's own link (her order 8 is delivered the
    // next day), so the code shows with its open and 0 % conversion; order 1's refund has no link
    const eleventh = await marketing({ from: '2026-11-11', to: '2026-11-11' });
    expect(
      eleventh.promoCodes.map((p) => [p.code, p.orders, p.opens, p.linkOrders, p.conversion]),
    ).toEqual([['BLOGER10', 0, 1, 0, 0]]);
    const automatic = eleventh.sources.find((s) => s.source === 'promo_code')!;
    expect([automatic.opens, automatic.orders, automatic.conversion]).toEqual([1, 0, 0]);
    expect(automatic.links.map((l) => l.link.code)).toEqual([code('bloger10')]);
    expect(eleventh.withoutLink).toMatchObject({ orders: 0, refunds: 40_000, net: -40_000 });
  });

  it("is the owner's: a manager gets 403, a backwards range 422", async () => {
    const manager = await t.managerSession();
    expect((await manager.client.admin.reports.marketing({ query: RANGE })).status).toBe(403);
    const backwards = await owner.client.admin.reports.marketing({
      query: { from: RANGE.to, to: RANGE.from },
    });
    expect(backwards.status).toBe(422);
    const res = await fetch(`${t.baseUrl}/admin/reports/marketing/export`, {
      headers: { cookie: manager.cookie },
    });
    expect(res.status).toBe(403);
  });

  it('exports the same figures to Excel', async () => {
    const res = await fetch(
      `${t.baseUrl}/admin/reports/marketing/export?from=${RANGE.from}&to=${RANGE.to}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Промокоды',
      'Источники',
      'Привлечение',
      'Скидка за набор',
    ]);
    const [promo, sources, acquisition, rights] = wb.worksheets;
    const rows = (ws: ExcelJS.Worksheet) =>
      ws
        .getSheetValues()
        .slice(2)
        .map((row) => (row as unknown[]).slice(1));
    const money = (e: MarketingFigures) => [
      e.orders,
      e.customers,
      e.firstTimeBuyers,
      e.itemsBeforeDiscount,
      e.discount,
      e.refunds,
      e.net,
      e.averageCheck ?? '',
    ];
    expect(promo!.getRow(1).getCell(1).value).toBe('Промокод');
    expect(rows(promo!).map((r) => [r[0], ...r.slice(2)])).toEqual(
      EXPECTED_PROMO_CODES.map((e) => [
        e.code,
        e.opens ?? '',
        ...money(e),
        e.linkOrders,
        e.conversion === null ? '' : e.conversion / 100,
      ]),
    );
    // a Source's row, then its links; then the orders without a link
    expect(rows(sources!).map((r) => r.slice(2))).toEqual([
      ...EXPECTED_SOURCES.flatMap((e) => {
        const row = [e.opens, ...money(e), e.conversion === null ? '' : e.conversion / 100];
        return e.link ? [row, row] : [row];
      }),
      ['', ...money(EXPECTED_WITHOUT_LINK), ''],
    ]);
    expect(rows(acquisition!).map((r) => r.slice(2))).toEqual([
      ...EXPECTED_ACQUISITION.flatMap((e) => {
        const row = [e.acquired, ...money(e)];
        return e.link ? [row, row] : [row];
      }),
      ['', ...money(EXPECTED_EARLIER_CUSTOMERS)],
      ['', ...money(EXPECTED_WITHOUT_FIRST_LINK)],
    ]);
    expect(rows(rights!).map((r) => r.slice(1))).toEqual(
      EXPECTED_UPGRADE_RIGHTS.map((e) => [e.issued, ...money(e)]),
    );
  });

  it('exports what the filters show', async () => {
    const res = await fetch(
      `${t.baseUrl}/admin/reports/marketing/export?from=${RANGE.from}&to=${RANGE.to}&source=blogger`,
      { headers: { cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.title).toContain('Источник: Блогер');
    const [promo, sources] = wb.worksheets;
    expect(promo!.getRow(2).getCell(1).value).toBe('BLOGER10');
    expect(promo!.rowCount).toBe(2);
    // the blogger row and its link, and no «Без ссылки» row
    expect(sources!.getColumn(1).values.slice(2)).toEqual(['Блогер', 'Блогер']);
  });
});

// Runs last: it changes the fixture.
describe('a returned set after the fact (#43)', () => {
  it('takes its rights out of «issued»; the right already used stays with order 7', async () => {
    await returnWhole(t, numberOf(2), 'Покупатель вернул набор');
    const r = await marketing(RANGE);
    // 2 no longer counts: issued 10 (1) + 14 (2) + 15 (1) = 4. Order 7 keeps its discount, and
    // is now ali's first Fulfilled order, so he is new there
    const ali7 = {
      orders: 1,
      customers: 1,
      firstTimeBuyers: 1,
      itemsBeforeDiscount: 200_000,
      discount: 30_000,
      refunds: 0,
      net: 170_000,
      averageCheck: 170_000,
    };
    expect(r.upgradeRights[0]).toEqual({ source: 'set', issued: 4, ...ali7 });
    // instagram loses 2 and its 15 000 refund (a returned order's money back is not counted)
    const instagram = r.sources.find((s) => s.source === 'instagram')!;
    expect(figuresOf(instagram)).toEqual(ali7);
  });
});

/** The Sources with «Без ссылки», and the acquisition with its two other rows, each sum to `totals`. */
function expectSplitsAddUpTo(
  r: MarketingReport,
  totals: Pick<MarketingFigures, 'orders' | 'itemsBeforeDiscount' | 'discount' | 'refunds' | 'net'>,
) {
  for (const rows of [
    [...r.sources, r.withoutLink],
    [...r.acquisition, r.earlierCustomers, r.withoutFirstLink],
  ]) {
    const sum = (key: keyof typeof totals) => rows.reduce((n, row) => n + row[key], 0);
    expect({
      orders: sum('orders'),
      itemsBeforeDiscount: sum('itemsBeforeDiscount'),
      discount: sum('discount'),
      refunds: sum('refunds'),
      net: sum('net'),
    }).toEqual(totals);
  }
}

const NO_SALES: MarketingFigures = {
  orders: 0,
  customers: 0,
  firstTimeBuyers: 0,
  itemsBeforeDiscount: 0,
  discount: 0,
  refunds: 0,
  net: 0,
  averageCheck: null,
};
