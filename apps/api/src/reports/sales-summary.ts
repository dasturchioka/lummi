import {
  addDays,
  formatLocalDate,
  parseLocalDate,
  SALES_REPORT_MAX_DAYS,
  tashkentDay,
  tashkentDayStart,
  tashkentDaySchema,
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
  or,
  orderLines,
  orders,
  refunds,
  sql,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import { fulfilledAt, fulfilledOrder } from '../orders/fulfilled';
import { discountShares } from './discount-shares';

/** Tashkent days `YYYY-MM-DD`, both inclusive. */
export interface TashkentRange {
  from: string;
  to: string;
}

/**
 * A range a report takes: two real Tashkent days written `YYYY-MM-DD`, `from` not after `to`,
 * at most `SALES_REPORT_MAX_DAYS` days.
 */
export function isSalesRange(range: TashkentRange): boolean {
  const real = (day: string) => tashkentDaySchema.safeParse(day).success;
  if (!real(range.from) || !real(range.to) || range.from > range.to) return false;
  const last = formatLocalDate(addDays(parseLocalDate(range.from), SALES_REPORT_MAX_DAYS - 1));
  return range.to <= last;
}

/** The `days` Tashkent days that end with `to`, `to` included. */
export function daysEnding(to: string, days: number): TashkentRange {
  return { from: formatLocalDate(addDays(parseLocalDate(to), 1 - days)), to };
}

/** The last `days` Tashkent days up to `now`'s Tashkent day, that day included. */
export function lastTashkentDays(days: number, now: Date): TashkentRange {
  return daysEnding(formatLocalDate(tashkentDay(now)), days);
}

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
 * read-only snapshot. A range that is not `isSalesRange` is a `RangeError`.
 */
export async function salesSummary(db: Db, range: TashkentRange): Promise<SalesReport> {
  if (!isSalesRange(range)) throw new RangeError(`not a report range: ${JSON.stringify(range)}`);
  // one snapshot for every read, so a refund or a delivery landing meanwhile never makes the
  // days and the top lists disagree
  return db.transaction((tx) => summarise(tx, range), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

async function summarise(db: DbOrTx, range: TashkentRange): Promise<SalesReport> {
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

  // a refund counts on greatest(its day, its order's delivery day), so the range takes those
  // sent by its end for orders delivered by its end, and sent or delivered on or after its start
  const refunded = await db
    .select({
      on: refunds.refundedOn,
      delivered: fulfilledAt,
      amount: sql<number>`sum(${refunds.amount})::bigint`.mapWith(Number),
    })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .where(
      and(
        fulfilledOrder,
        lte(refunds.refundedOn, range.to),
        sql`${fulfilledAt} < ${end.toISOString()}`,
        or(gte(refunds.refundedOn, range.from), sql`${fulfilledAt} >= ${start.toISOString()}`),
      ),
    )
    .groupBy(refunds.refundedOn, orders.id);

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
  for (const r of refunded) {
    const delivered = formatLocalDate(tashkentDay(r.delivered!));
    byDay.get(r.on > delivered ? r.on : delivered)!.refunds += r.amount;
  }
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

/**
 * `total ÷ count` to the nearest so'm, halves up; null for no count. The reports' average check
 * and the admin Home's average payment (#48) round alike. For a total of zero or more.
 */
export function roundedAverage(total: number, count: number): number | null {
  return count === 0 ? null : Math.floor((2 * total + count) / (2 * count));
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
