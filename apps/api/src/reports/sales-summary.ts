import {
  addDays,
  formatLocalDate,
  parseLocalDate,
  tashkentDay,
  type FragranceSales,
  type SalesDay,
  type SalesFigures,
  type SalesProfit,
  type SalesReport,
  type SetSales,
  type VolumeSales,
} from '@lummi/contracts';
import { asc, inArray, orderLines, type Db, type DbOrTx } from '@lummi/db';
import { sharedBy } from './shares';
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
 * - **Profit** (#77) reads each order's cost snapshot, frozen at its payment: the range's revenue,
 *   cost, profit and margin over the orders that have one (`uncosted` counts the rest). A row's
 *   cost is its lines at their frozen unit cost plus their share of their order's other costs,
 *   shared by the lines' net (`sharedBy`), so the rows' profits add up to the range's; a row with
 *   a line from an order without costs has none.
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
          unitCost: orderLines.unitCost,
          giftSample: orderLines.giftSample,
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
    ['discovery_set', { kind: 'discovery_set', units: 0, net: 0, cost: 0, profit: 0 }],
    ['builder_set', { kind: 'builder_set', units: 0, net: 0, cost: 0, profit: 0 }],
  ]);
  for (const [orderId, its] of linesOf) {
    const o = order.get(orderId)!;
    const at = o.deliveredAt.getTime();
    // the snapshot's own discount: a Promo gift's line costs 0 and takes no share, so its net is 0
    const shares = discountShares(its, o.discount, o.snapshotDiscountAmount);
    const nets = its.map((l, i) => l.lineTotal - shares[i]!);
    const costed = o.profit !== null && its.every((l) => l.unitCost !== null);
    // its Order costs (all but the goods), shared by the lines' net
    const other = costed ? sharedBy(o.profit!.cost - o.profit!.goods, nets) : null;
    its.forEach((l, i) => {
      // a first order's gift sample is no sale (ADR 0042): its cost is in the order costs, which
      // the paid lines share above, so it is no row of its own
      if (l.giftSample) return;
      const net = nets[i]!;
      const cost = other ? l.unitCost! * l.qty + other[i]! : null;
      if (l.kind !== 'volume') {
        const set = sets.get(l.kind)!;
        set.units += l.qty;
        set.net += net;
        addCost(set, net, cost);
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
        cost: 0,
        profit: 0,
        at,
      };
      add(f, { name, brand: l.brand, qty: l.qty, net, cost, at });
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
        cost: 0,
        profit: 0,
        at,
      };
      add(v, { name, brand: l.brand, qty: l.qty, net, cost, at });
      volumes.set(volumeId, v);
    });
  }

  return {
    from: range.from,
    to: range.to,
    days: daily,
    totals,
    profit: profitOf(sold),
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
    cost: number | null;
    profit: number | null;
    at: number;
  },
  line: {
    name: { ru: string; uz: string };
    brand: string | null;
    qty: number;
    net: number;
    cost: number | null;
    at: number;
  },
) {
  row.units += line.qty;
  row.net += line.net;
  addCost(row, line.net, line.cost);
  if (line.at > row.at) Object.assign(row, { name: line.name, brand: line.brand, at: line.at });
}

/** A line's cost and profit on its row; a line without cost leaves the row without (null). */
function addCost(
  row: { cost: number | null; profit: number | null },
  net: number,
  cost: number | null,
) {
  if (row.cost === null || row.profit === null || cost === null) {
    row.cost = null;
    row.profit = null;
    return;
  }
  row.cost += cost;
  row.profit += net - cost;
}

/** The range's profit over the orders with a cost snapshot (#77); the rest are `uncosted`. */
function profitOf(
  sold: readonly { profit: { revenue: number; cost: number } | null }[],
): SalesProfit {
  const p = { orders: 0, uncosted: 0, revenue: 0, cost: 0 };
  for (const o of sold) {
    if (!o.profit) {
      p.uncosted += 1;
      continue;
    }
    p.orders += 1;
    p.revenue += o.profit.revenue;
    p.cost += o.profit.cost;
  }
  const profit = p.revenue - p.cost;
  return { ...p, profit, margin: p.revenue > 0 ? profit / p.revenue : null };
}

/** Most units first, then most net, then the lower id. */
function ranked<R extends { units: number; net: number }>(rows: R[], id: (r: R) => number): R[] {
  return rows.sort((a, b) => b.units - a.units || b.net - a.net || id(a) - id(b));
}
