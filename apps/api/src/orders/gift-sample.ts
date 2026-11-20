import type { GiftSampleStock } from '@lummi/contracts';
import { NOT_SOLD_ALONE_ML } from '@lummi/contracts/constants';
import {
  and,
  asc,
  eq,
  fragrances,
  ne,
  orders,
  volumes,
  type DbOrTx,
  type orderLines,
  type OrderLineRow,
} from '@lummi/db';
import { readLiquidStock } from '../catalog/catalog.service';
import { readSettings } from '../settings/settings.service';

/**
 * The gift sample (#79, ADR 0042): a customer's first order gets one 5 ml bottle free. It is a line
 * of the order at 0 (`order_lines.gift_sample`) on the fragrance's 5 ml volume, so it is reserved,
 * handed over and returned like any volume line. It is not a Discount (ADR 0002): it changes no
 * price and rides with any discount. Its cost goes into the order's profit (#77).
 *
 * «First order» is derived, never stored: the customer has no order that is not cancelled. A
 * cancelled first order therefore leaves the sample for the next; a delivered or returned one, or
 * one still open, has it. Checkout holds the customer's row lock, so two orders of one customer
 * cannot both be first.
 */
export interface GiftSample {
  volumeId: number;
  fragranceId: number;
  slug: string;
  name: string;
  brand: string;
  /** The 5 ml bottle's own photo, else the fragrance's 10 ml one; null without either. */
  photo: string | null;
}

/** True when the customer has no order but cancelled ones: the next order is their first. */
export async function isFirstOrder(tx: DbOrTx, customerId: number): Promise<boolean> {
  const [other] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), ne(orders.status, 'cancelled')))
    .limit(1);
  return other === undefined;
}

/**
 * The sample the customer's next order would get, read now (checkout locks its fragrance with the
 * others and checks it again once the order's own lines hold their fills,
 * `giftSampleStillAvailable`): null while the setting is off, when it is not the customer's first
 * order, or when no 5 ml fill is free (ADR 0043). The setting `giftSample.fragranceId` names it; 0
 * picks the visible fragrance with the most 5 ml fills free, ties by name. A named fragrance that
 * is hidden or out of concentrate gives none.
 */
export async function pickGiftSample(tx: DbOrTx, customerId: number): Promise<GiftSample | null> {
  const s = await readSettings(tx, ['giftSample.enabled', 'giftSample.fragranceId']);
  if (!s['giftSample.enabled']) return null;
  if (!(await isFirstOrder(tx, customerId))) return null;
  const named = s['giftSample.fragranceId'];
  const rows = await tx
    .select({
      volumeId: volumes.id,
      fragranceId: fragrances.id,
      slug: fragrances.slug,
      name: fragrances.name,
      brand: fragrances.originalBrand,
      photo: volumes.photoHash,
    })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(
      and(
        eq(volumes.ml, NOT_SOLD_ALONE_ML),
        eq(fragrances.hidden, false),
        named > 0 ? eq(fragrances.id, named) : undefined,
      ),
    )
    .orderBy(asc(fragrances.name), asc(fragrances.id));
  if (rows.length === 0) return null;
  const stock = await readLiquidStock(
    tx,
    rows.map((r) => r.fragranceId),
  );
  let best: (typeof rows)[number] | null = null;
  let bestLeft = 0;
  for (const r of rows) {
    const left = stock.bottles(r.fragranceId, NOT_SOLD_ALONE_ML);
    if (left > bestLeft) {
      best = r;
      bestLeft = left;
    }
  }
  if (!best) return null;
  const { photo, ...sample } = best;
  return { ...sample, photo: photo ?? (await tenMlPhoto(tx, best.fragranceId)) };
}

/**
 * Under checkout's lock on its fragrance, once the order's own lines are written (so they hold
 * their fills): whether a 5 ml fill is still free for the sample (ADR 0043).
 */
export async function giftSampleStillAvailable(tx: DbOrTx, fragranceId: number): Promise<boolean> {
  return (await readLiquidStock(tx, [fragranceId])).bottles(fragranceId, NOT_SOLD_ALONE_ML) > 0;
}

async function tenMlPhoto(tx: DbOrTx, fragranceId: number): Promise<string | null> {
  const [v] = await tx
    .select({ photo: volumes.photoHash })
    .from(volumes)
    .where(and(eq(volumes.fragranceId, fragranceId), eq(volumes.ml, 10)));
  return v?.photo ?? null;
}

/** The sample as an order line: one 5 ml bottle at 0, no price of its own, flagged. */
export function giftSampleLine(
  orderId: number,
  position: number,
  g: GiftSample,
): typeof orderLines.$inferInsert {
  return {
    orderId,
    position,
    kind: 'volume',
    volumeId: g.volumeId,
    fragranceId: g.fragranceId,
    slug: g.slug,
    // a fragrance has one name in both languages (ADR 0018)
    nameRu: g.name,
    nameUz: g.name,
    brand: g.brand,
    ml: NOT_SOLD_ALONE_ML,
    photo: g.photo,
    unitPrice: 0,
    regularUnitPrice: 0,
    markedDown: false,
    qty: 1,
    lineTotal: 0,
    giftSample: true,
  };
}

/** The order's gift sample line, if it has one. */
export const giftSampleOf = (lines: readonly OrderLineRow[]): OrderLineRow | undefined =>
  lines.find((l) => l.giftSample);

/**
 * The gift sample's 5 ml stock (#79, ADR 0043), for the stock page and Home's warning: the 5 ml
 * fills the chosen fragrance's free concentrate makes, or every visible fragrance's together while
 * the most-stocked one is picked, against the setting `giftSample.lowStock`. A chosen fragrance that is gone or hidden is
 * `missing` (no sample goes out), never a silent off. Null while samples are off.
 */
export async function giftSampleStock(tx: DbOrTx): Promise<GiftSampleStock | null> {
  const s = await readSettings(tx, [
    'giftSample.enabled',
    'giftSample.fragranceId',
    'giftSample.lowStock',
  ]);
  if (!s['giftSample.enabled']) return null;
  const named = s['giftSample.fragranceId'];
  const threshold = s['giftSample.lowStock'];
  const rows = await tx
    .select({
      fragranceId: fragrances.id,
      name: fragrances.name,
      hidden: fragrances.hidden,
    })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(
      and(
        eq(volumes.ml, NOT_SOLD_ALONE_ML),
        named > 0 ? eq(fragrances.id, named) : eq(fragrances.hidden, false),
      ),
    );
  const chosen = named > 0 ? (rows[0] ?? null) : null;
  const missing = named > 0 && (chosen === null || chosen.hidden);
  const counted = missing ? [] : rows;
  const stock = await readLiquidStock(
    tx,
    counted.map((r) => r.fragranceId),
  );
  const left = counted.reduce((sum, r) => sum + stock.bottles(r.fragranceId, NOT_SOLD_ALONE_ML), 0);
  return {
    fragrance: chosen?.name ?? null,
    missing,
    available: left,
    threshold,
    level: left === 0 ? 'zero' : left <= threshold ? 'low' : 'ok',
  };
}
