import {
  addDays,
  formatLocalDate,
  parseLocalDate,
  tashkentDay,
  type FragranceSales,
  type SalesDay,
  type SalesFigures,
  type SalesReport,
  type SetSales,
  type VolumeSales,
} from '@lummi/contracts';
import { asc, inArray, orderLines, type Db, type DbOrTx } from '@lummi/db';
import { discountShares } from './discount-shares';
import { countedRefunds, deliveredIn } from './report-orders';
import { isReportRange, roundedAverage, type TashkentRange } from './report-range';

/**
 * Sales over a range of Tashkent days (TZ §7 «Отчёты», #42): the one computation behind the
 * report page, its Excel export and any later summary (the admin Home). It reads only order
 * snapshots and Refunds, never the catalog's current prices.
 *
 * - **Which orders:** Fulfilled ones (`FULFILLED_STATUSES`: «Доставлен», not returned), each
 *   counted on the Tashkent day it reached «Доставлен» (`fulfilledAt`). A return drops the order
 *   out by its status, on every day.
 * - **Refunds** count only for orders that are Fulfilled (a cancelled or returned order's sale is
 *   not counted, so neither is its money back), on the day they were sent (`refunded_on`) or, for
 *   money sent back before delivery, on the delivery day: never on a day before the order counts.
 * - **Net** = items before discount − discount − refunds; delivery is shown beside it, never in
 *   it. **Average check** = (items before discount − discount) ÷ orders, the TZ's «Чистые
 *   продажи / выданные заказы» before refunds, to the nearest so'm, halves up.
 * - **Fragrances and Volumes** take volume lines; a set counts per set, as its own row. A line's
 *   net is its total less its share of the order's discount (`discountShares`); refunds name no
 *   line, so they stay out of these lists.
 *
 * Amounts are integer so'm. Refunds are summed in SQL as `bigint` (per order and day); the order
 * figures and the rest are exact integer sums in code, far below 2^53. Every read happens in one
 * read-only snapshot. A range that is not `isReportRange` is a `RangeError`.
 */
export async function salesSummary(db: Db, range: TashkentRange): Promise<SalesReport> {
  if (!isReportRange(range)) throw new RangeError(`not a report range: ${JSON.stringify(range)}`);
  // one snapshot for every read, so a refund or a delivery landing meanwhile never makes the
  // days and the top lists disagree
  return db.transaction((tx) => summarise(tx, range), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

async function summarise(db: DbOrTx, range: TashkentRange): Promise<SalesReport> {
  const days = daysOf(range);
  const sold = await deliveredIn(db, range);
  const refunded = await countedRefunds(db, range);

  const lines = sold.length
    ? await db
        .select({
          orderId: orderLines.orderId,
          position: orderLines.position,
          kind: orderLines.kind,
          volumeId: orderLines.volumeId,
          fragranceId: orderLines.fragranceId,
          nameRu: orderLines.nameRu,
          nameUz: orderLines.nameUz,
          brand: orderLines.brand,
          ml: orderLines.ml,
          qty: orderLines.qty,
          lineTotal: orderLines.lineTotal,
          markedDown: orderLines.markedDown,
        })
        .from(orderLines)
        .where(
          inArray(
            orderLines.orderId,
            sold.map((o) => o.id),
          ),
        )
        .orderBy(asc(orderLines.orderId), asc(orderLines.position))
    : [];

  // ---- by day
  const byDay = new Map(days.map((day) => [day, blank()]));
  for (const o of sold) {
    const f = byDay.get(formatLocalDate(tashkentDay(o.deliveredAt)))!;
    f.orders += 1;
    f.itemsBeforeDiscount += o.items;
    f.discount += o.discountAmount;
    f.delivery += o.delivery;
  }
  for (const r of refunded) byDay.get(r.day)!.refunds += r.amount;
  const daily: SalesDay[] = days.map((day) => ({ day, ...settle(byDay.get(day)!) }));
  const totals = settle(
    [...byDay.values()].reduce((sum, f) => {
      sum.orders += f.orders;
      sum.itemsBeforeDiscount += f.itemsBeforeDiscount;
      sum.discount += f.discount;
      sum.delivery += f.delivery;
      sum.refunds += f.refunds;
      return sum;
    }, blank()),
  );

  // ---- by fragrance, Volume and set: each line's total less its share of the discount
  const order = new Map(sold.map((o) => [o.id, o]));
  const linesOf = new Map<number, typeof lines>();
  for (const l of lines) {
    const its = linesOf.get(l.orderId);
    if (its) its.push(l);
    else linesOf.set(l.orderId, [l]);
  }
  const fragrances = new Map<number, FragranceSales & { at: number }>();
  const volumes = new Map<number, VolumeSales & { at: number }>();
  const sets = new Map<SetSales['kind'], SetSales>([
    ['discovery_set', { kind: 'discovery_set', units: 0, net: 0 }],
    ['builder_set', { kind: 'builder_set', units: 0, net: 0 }],
  ]);
  for (const [orderId, its] of linesOf) {
    const o = order.get(orderId)!;
    const at = o.deliveredAt.getTime();
    // the snapshot's own discount: a gift line costs 0 and takes no share, so its net is 0 (ADR 0039)
    const shares = discountShares(its, o.discount, o.discountAmount - o.giftValue);
    its.forEach((l, i) => {
      const net = l.lineTotal - shares[i]!;
      if (l.kind !== 'volume') {
        const set = sets.get(l.kind)!;
        set.units += l.qty;
        set.net += net;
        return;
      }
      const name = { ru: l.nameRu, uz: l.nameUz };
      const fragranceId = l.fragranceId!;
      const f = fragrances.get(fragranceId) ?? {
        fragranceId,
        name,
        brand: l.brand,
        units: 0,
        net: 0,
        at,
      };
      add(f, { name, brand: l.brand, qty: l.qty, net, at });
      fragrances.set(fragranceId, f);
      const volumeId = l.volumeId!;
      const v = volumes.get(volumeId) ?? {
        volumeId,
        fragranceId,
        ml: l.ml,
        name,
        brand: l.brand,
        units: 0,
        net: 0,
        at,
      };
      add(v, { name, brand: l.brand, qty: l.qty, net, at });
      volumes.set(volumeId, v);
    });
  }

  return {
    from: range.from,
    to: range.to,
    days: daily,
    totals,
    fragrances: ranked([...fragrances.values()], (r) => r.fragranceId).map(
      ({ at: _at, ...r }) => r,
    ),
    volumes: ranked([...volumes.values()], (r) => r.volumeId).map(({ at: _at, ...r }) => r),
    sets: [...sets.values()],
  };
}

/** Every day of the range, oldest first. */
function daysOf(range: TashkentRange): string[] {
  const out: string[] = [];
  for (let d = parseLocalDate(range.from); formatLocalDate(d) <= range.to; d = addDays(d, 1))
    out.push(formatLocalDate(d));
  return out;
}

type Sums = Omit<SalesFigures, 'net' | 'averageCheck'>;

const blank = (): Sums => ({
  orders: 0,
  itemsBeforeDiscount: 0,
  discount: 0,
  delivery: 0,
  refunds: 0,
});

/**
 * Net and the average check from the sums. Net takes the refunds off; the average does not (TZ:
 * net sales before refunds ÷ orders), rounded to the so'm, halves up, so it is never below zero.
 */
function settle(s: Sums): SalesFigures {
  const sold = s.itemsBeforeDiscount - s.discount;
  return { ...s, net: sold - s.refunds, averageCheck: roundedAverage(sold, s.orders) };
}

/** Adds a line to a row; the row keeps the name and brand of the latest order that sold it. */
function add(
  row: {
    name: { ru: string; uz: string };
    brand: string | null;
    units: number;
    net: number;
    at: number;
  },
  line: {
    name: { ru: string; uz: string };
    brand: string | null;
    qty: number;
    net: number;
    at: number;
  },
) {
  row.units += line.qty;
  row.net += line.net;
  if (line.at > row.at) Object.assign(row, { name: line.name, brand: line.brand, at: line.at });
}

/** Most units first, then most net, then the lower id. */
function ranked<R extends { units: number; net: number }>(rows: R[], id: (r: R) => number): R[] {
  return rows.sort((a, b) => b.units - a.units || b.net - a.net || id(a) - id(b));
}
