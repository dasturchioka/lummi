import { normalizePromoCode } from '@lummi/contracts/constants';
import type { PromoCodeState, PromoGiftItem } from '@lummi/contracts';
import {
  and,
  carts,
  eq,
  isNull,
  ne,
  orders,
  promoCodes,
  promoCodeUses,
  sql,
  type DbOrTx,
  type PromoCodeRow,
} from '@lummi/db';
import type { PromoCode, RefusedPromoCode } from '../pricing/quote';

/**
 * Promo codes as orders and the cart see them (ticket #29; ADR 0005; spec Changes 2026-11-07
 * promo counting): the checks needing the DB, the lock `createOrder` holds while it counts, the
 * use it writes, and the void a cancel or return makes. The money itself is `quote()`'s.
 */

/**
 * A code's terms as the DB gives them. A gift code names its item only: its price and whether any
 * is left after the cart's own lines are the cart's to find (`loadQuote`, ADR 0039).
 */
export type PromoTerms =
  | Exclude<PromoCode, { kind: 'gift' }>
  | (Omit<Extract<PromoCode, { kind: 'gift' }>, 'gift'> & { giftItem: PromoGiftItem });

/** What the cart's quote gets for the entered code, and the code's id when it passed. */
export interface JudgedPromoCode {
  promoCode: PromoTerms | RefusedPromoCode;
  /** Set only when the code passed every DB check, so `quote()` may apply it. */
  promoCodeId: number | null;
}

/**
 * `expires_at` is 23:59:59 Asia/Tashkent of the last day; the code works through that whole
 * second and stops at 00:00:00 the next day.
 */
export function isPastExpiry(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() >= expiresAt.getTime() + 1000;
}

/** Uses held by orders not cancelled or returned: in total, and by one customer. */
export async function countUses(
  tx: DbOrTx,
  promoCodeId: number,
  customerId: number | null,
): Promise<{ total: number; mine: number }> {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      mine:
        customerId === null
          ? sql<number>`0`
          : sql<number>`(count(*) filter (where ${promoCodeUses.customerId} = ${customerId}))::int`,
    })
    .from(promoCodeUses)
    .where(and(eq(promoCodeUses.promoCodeId, promoCodeId), isNull(promoCodeUses.voidedAt)));
  return { total: Number(row?.total ?? 0), mine: Number(row?.mine ?? 0) };
}

/** A New customer has no other non-cancelled order (awaiting payment, delivered, returned all count). */
async function hasOrders(tx: DbOrTx, customerId: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), ne(orders.status, 'cancelled')))
    .limit(1);
  return row !== undefined;
}

/**
 * The entered code as the quote must see it: refused with its reason (unknown, switched off, past
 * its last day, every use taken, this customer's uses taken, not a new customer), or its terms.
 * The pricing checks (minimum, eligible items) are `quote()`'s.
 */
export async function judgePromoCode(
  tx: DbOrTx,
  entered: string,
  customerId: number,
  now: Date,
): Promise<JudgedPromoCode> {
  const code = normalizePromoCode(entered);
  const refused = (reason: RefusedPromoCode['refused']): JudgedPromoCode => ({
    promoCode: { code, refused: reason },
    promoCodeId: null,
  });
  const [p] = await tx.select().from(promoCodes).where(eq(promoCodes.code, code));
  if (!p) return refused('unknown');
  if (!p.active) return refused('inactive');
  if (isPastExpiry(p.expiresAt, now)) return refused('expired');
  const uses = await countUses(tx, p.id, customerId);
  if (p.totalLimit !== null && uses.total >= p.totalLimit) return refused('exhausted');
  if (p.perCustomerLimit !== null && uses.mine >= p.perCustomerLimit)
    return refused('already_used');
  if (p.newCustomersOnly && (await hasOrders(tx, customerId))) return refused('not_new_customer');
  return { promoCode: terms(p), promoCodeId: p.id };
}

function terms(p: PromoCodeRow): PromoTerms {
  const common = {
    code: p.code,
    minOrderTotal: p.minOrderTotal,
    appliesToMarkedDown: p.appliesToMarkedDown,
  };
  if (p.kind === 'gift') {
    if (p.giftDiscoverySet) return { ...common, kind: 'gift', giftItem: { kind: 'discovery_set' } };
    if (p.giftVolumeId === null) throw new Error(`promo ${p.code}: a gift code without a gift`);
    return { ...common, kind: 'gift', giftItem: { kind: 'volume', volumeId: p.giftVolumeId } };
  }
  if (p.kind === 'fixed') {
    if (p.amount === null) throw new Error(`promo ${p.code}: a fixed code without an amount`);
    return { ...common, kind: 'fixed', amount: p.amount };
  }
  if (p.percent === null) throw new Error(`promo ${p.code}: a percent code without a percent`);
  return { ...common, kind: 'percent', percent: p.percent, maxDiscount: p.maxDiscount };
}

/**
 * The gift the code in the customer's cart names, read without a lock (ADR 0039): checkout locks
 * its stock row with the others before it locks the code; null for no code or another kind.
 */
export async function enteredGift(tx: DbOrTx, customerId: number): Promise<PromoGiftItem | null> {
  const [row] = await tx
    .select({ volumeId: promoCodes.giftVolumeId, discovery: promoCodes.giftDiscoverySet })
    .from(promoCodes)
    .innerJoin(carts, eq(carts.promoCode, promoCodes.code))
    .where(eq(carts.customerId, customerId));
  if (!row) return null;
  if (row.discovery) return { kind: 'discovery_set' };
  return row.volumeId === null ? null : { kind: 'volume', volumeId: row.volumeId };
}

/**
 * Locks the row of the code in the customer's cart (`FOR UPDATE`, ADR 0005), so the quote that
 * follows counts its uses while no other order can take one; the lock holds until the order
 * commits with its use. An unknown code locks nothing.
 */
export async function lockEnteredPromoCode(tx: DbOrTx, customerId: number): Promise<void> {
  await tx
    .select({ id: promoCodes.id })
    .from(promoCodes)
    .innerJoin(carts, eq(carts.promoCode, promoCodes.code))
    .where(eq(carts.customerId, customerId))
    .for('update', { of: promoCodes });
}

/** The order holds one use of the code it was priced with (under the lock above). */
export async function recordPromoUse(
  tx: DbOrTx,
  use: { promoCodeId: number; orderId: number; customerId: number; at: Date },
): Promise<void> {
  await tx.insert(promoCodeUses).values({
    promoCodeId: use.promoCodeId,
    orderId: use.orderId,
    customerId: use.customerId,
    createdAt: use.at,
  });
}

/** A cancelled or returned order's use stops counting against the limits (ADR 0005). */
export async function voidPromoUse(tx: DbOrTx, orderId: number, at: Date): Promise<void> {
  await tx
    .update(promoCodeUses)
    .set({ voidedAt: at })
    .where(and(eq(promoCodeUses.orderId, orderId), isNull(promoCodeUses.voidedAt)));
}

/** The admin list badge, in the order the shopper's refusals are checked. */
export function promoState(p: PromoCodeRow, uses: number, now: Date): PromoCodeState {
  if (!p.active) return 'inactive';
  if (isPastExpiry(p.expiresAt, now)) return 'expired';
  if (p.totalLimit !== null && uses >= p.totalLimit) return 'exhausted';
  return 'active';
}
