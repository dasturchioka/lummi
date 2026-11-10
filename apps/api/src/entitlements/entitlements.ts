import type { Discount } from '@lummi/contracts';
import type { DbOrTx } from '@lummi/db';
import {
  birthdayEntitlements,
  holdBirthdayCoupon,
  releaseBirthdayCoupon,
} from '../birthday/birthday-coupons';
import type { Entitlement } from '../pricing/quote';

/**
 * Entitlements (GLOSSARY): the discount sources a customer holds and that apply without typing
 * anything. The server picks among them in `quote()` (ADR 0002: without an entered promo code, the
 * one giving the lowest total including delivery, or the customer's switch while it still
 * applies); this module is everything around that choice that needs the DB, one source at a time:
 * - `loadEntitlements`: every source's active entitlements, as `quote()` takes them;
 * - `holdEntitlement`: `createOrder` holds the one the quote applied (ADR 0005, a conditional
 *   update) in the order's transaction;
 * - `releaseEntitlements`: a cancelled or returned order gives back what it held.
 *
 * A new source (the upgrade rights of #38) is one more `EntitlementSource` in `SOURCES`.
 */
export interface EntitlementSource {
  type: Entitlement['type'];
  /** The customer's entitlements of this source that may discount an order at `now`. */
  active(tx: DbOrTx, customerId: number, now: Date): Promise<Entitlement[]>;
  /** Held by the order unless another order holds it or it expired; false then. */
  hold(
    tx: DbOrTx,
    hold: { id: number; customerId: number; orderId: number; now: Date },
  ): Promise<boolean>;
  /** Whatever of this source the order held is active again while within validity. */
  release(tx: DbOrTx, orderId: number): Promise<void>;
}

const birthdayCouponSource: EntitlementSource = {
  type: 'birthday_coupon',
  active: birthdayEntitlements,
  hold: (tx, h) =>
    holdBirthdayCoupon(tx, {
      couponId: h.id,
      customerId: h.customerId,
      orderId: h.orderId,
      now: h.now,
    }),
  release: releaseBirthdayCoupon,
};

const SOURCES: readonly EntitlementSource[] = [birthdayCouponSource];

/** The Discount of an entitlement (not a promo code). */
export type EntitlementDiscount = Extract<Discount, { type: Entitlement['type'] }>;

export function isEntitlementDiscount(d: Discount | null): d is EntitlementDiscount {
  return d !== null && d.type !== 'promo_code';
}

/** Every source's active entitlements, for the quote. */
export async function loadEntitlements(
  tx: DbOrTx,
  customerId: number,
  now: Date,
): Promise<Entitlement[]> {
  const lists = await Promise.all(SOURCES.map((s) => s.active(tx, customerId, now)));
  return lists.flat();
}

/** The source the quote applied: it must be one this module knows (a new type comes with its source). */
function sourceOf(type: Entitlement['type']): EntitlementSource {
  const source = SOURCES.find((s) => s.type === type);
  if (!source) throw new Error(`no entitlement source for ${type}`);
  return source;
}

/** ADR 0005: the order holds the entitlement its quote applied; false when it was taken or ended. */
export function holdEntitlement(
  tx: DbOrTx,
  discount: EntitlementDiscount,
  hold: { customerId: number; orderId: number; now: Date },
): Promise<boolean> {
  return sourceOf(discount.type).hold(tx, { id: discount.id, ...hold });
}

/** ADR 0005: a cancelled or returned order gives back the entitlement it held, whatever its source. */
export async function releaseEntitlements(tx: DbOrTx, orderId: number): Promise<void> {
  for (const s of SOURCES) await s.release(tx, orderId);
}

/**
 * The entitlement the quote applied was gone by the time the order tried to hold it. Under the
 * customer lock `createOrder` takes, nothing in the shop does that between its quote and its hold;
 * the conditional update is the guard all the same, and the order is created again from a new quote.
 */
export class EntitlementLostError extends Error {
  constructor(readonly discount: EntitlementDiscount) {
    super(`${discount.type} ${discount.id} was no longer free to hold`);
  }
}
