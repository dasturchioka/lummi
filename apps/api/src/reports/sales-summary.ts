import {
  addDays,
  formatLocalDate,
  parseLocalDate,
  tashkentDay,
  tashkentDayStart,
  type FragranceSales,
  type SalesDay,
  type SalesFigures,
  type SalesReport,
  type SetSales,
  type VolumeSales,
} from '@lummi/contracts';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lte,
  orderLines,
  orders,
  refunds,
  sql,
  type DbOrTx,
} from '@lummi/db';
import { fulfilledAt, fulfilledOrder } from '../orders/fulfilled';
import { discountShares } from './discount-shares';

/** Tashkent days `YYYY-MM-DD`, both inclusive, `from` not after `to`. */
export interface TashkentRange {
  from: string;
  to: string;
}

/**
 * Sales over a range of Tashkent days (TZ §7 «Отчёты», #42): the one computation behind the
 * report page, its Excel export and any later summary (the admin Home). It reads only order
 * snapshots and Refunds, never the catalog's current prices.
 *
 * - **Which orders:** Fulfilled ones (`FULFILLED_STATUSES`: «Доставлен», not returned), each
 *   counted on the Tashkent day it reached «Доставлен» (`fulfilledAt`). A return drops the order
 *   out by its status, on every day.
 * - **Refunds** count on the day they were sent (`refunded_on`), and only for orders that are
 *   Fulfilled: a cancelled or returned order's sale is not counted, so neither is its money back.
 * - **Net** = items before discount − discount − refunds; delivery is shown beside it, never in
 *   it. **Average check** = net ÷ orders, to the nearest so'm, halves up.
 * - **Fragrances and Volumes** take volume lines; a set counts per set, as its own row. A line's
 *   net is its total less its share of the order's discount (`discountShares`); refunds name no
 *   line, so they stay out of these lists.
 *
 * Amounts are integer so'm; the database sums them as `bigint`, and the sums here stay exact
 * integers far below 2^53.
 */
export async function salesSummary(db: DbOrTx, range: TashkentRange): Promise<SalesReport> {
  const days = daysOf(range);
  const start = tashkentDayStart(range.from);
  const end = tashkentDayStart(range.to, 1);

  const sold = await db
    .select({
      id: orders.id,
      at: fulfilledAt,
      items: orders.itemsSubtotal,
      discount: orders.discount,
      discountAmount: orders.discountAmount,
      delivery: orders.deliveryFee,
    })
    .from(orders)
    .where(
      and(
        fulfilledOrder,
        sql`${fulfilledAt} >= ${start.toISOString()}`,
        sql`${fulfilledAt} < ${end.toISOString()}`,
      ),
    );

  const refundsByDay = await db
    .select({
      day: refunds.refundedOn,
      amount: sql<number>`sum(${refunds.amount})::bigint`.mapWith(Number),
    })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .where(
      and(fulfilledOrder, gte(refunds.refundedOn, range.from), lte(refunds.refundedOn, range.to)),
    )
    .groupBy(refunds.refundedOn);

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
    const f = byDay.get(formatLocalDate(tashkentDay(o.at!)))!;
    f.orders += 1;
    f.itemsBeforeDiscount += o.items;
    f.discount += o.discountAmount;
    f.delivery += o.delivery;
  }
  for (const r of refundsByDay) byDay.get(r.day)!.refunds += r.amount;
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
    const at = o.at!.getTime();
    const shares = discountShares(its, o.discount, o.discountAmount);
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
  if (range.from > range.to) throw new RangeError(`${range.from} is after ${range.to}`);
  const out: string[] = [];
  for (let d = parseLocalDate(range.from); ; d = addDays(d, 1)) {
    const day = formatLocalDate(d);
    out.push(day);
    if (day === range.to) return out;
  }
}

type Sums = Omit<SalesFigures, 'net' | 'averageCheck'>;

const blank = (): Sums => ({
  orders: 0,
  itemsBeforeDiscount: 0,
  discount: 0,
  delivery: 0,
  refunds: 0,
});

/** Net and the average check from the sums: net ÷ orders, rounded to the so'm, halves up. */
function settle(s: Sums): SalesFigures {
  const net = s.itemsBeforeDiscount - s.discount - s.refunds;
  const averageCheck = s.orders === 0 ? null : Math.floor((2 * net + s.orders) / (2 * s.orders));
  return { ...s, net, averageCheck };
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
