import {
  formatLocalDate,
  lastDayOf,
  type CartDto,
  type Discount,
  type DiscountOptionDto,
  type Quote,
} from '@lummi/contracts';
import type { DbOrTx } from '@lummi/db';
import {
  birthdayEntitlements,
  heldBirthdayCoupon,
  holdBirthdayCoupon,
  releaseBirthdayCoupon,
} from '../birthday/birthday-coupons';
import type { DiscountChoice, Entitlement } from '../pricing/quote';
import {
  heldUpgradeRight,
  holdUpgradeRight,
  releaseUpgradeRight,
  upgradeRightEntitlements,
  readUpgradeRightSource,
} from '../upgrade-rights/upgrade-rights';

/**
 * Entitlements (GLOSSARY): the discount sources a customer holds and that apply without typing
 * anything. The server picks among them in `quote()` (ADR 0002: without an entered promo code, the
 * one giving the lowest total including delivery, or the customer's switch while it still
 * applies); this module is everything around that choice that needs the DB, one source at a time:
 * - `loadEntitlements`: every source's active entitlements, as `quote()` takes them;
 * - `holdEntitlement`: `createOrder` holds the one the quote applied (ADR 0005, a conditional
 *   update) in the order's transaction;
 * - `releaseEntitlements`: a cancelled or returned order gives back what it held;
 * - `heldEntitlement`: what the order holds and whether that release would give it back now (the
 *   return dialog's preview, #40), by the same condition the release writes with.
 *
 * Each source is one `EntitlementSource` in `SOURCES`: the birthday coupon (#30) and the upgrade
 * right (#38).
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
  /** Whatever of this source the order held is active again while within validity; past it, lost. */
  release(tx: DbOrTx, orderId: number, now: Date): Promise<void>;
  /** What of this source the order holds, and whether `release` at `now` would give it back. */
  held(tx: DbOrTx, orderId: number, now: Date): Promise<HeldEntitlement | null>;
}

/**
 * An entitlement an order holds: when it ends, and whether a cancel or return now gives it back
 * (`lost: null`) or why not: its term is over (`expired`), or it was closed (`closed`: an upgrade
 * right whose source order was returned, #38).
 */
export interface HeldEntitlement {
  expiresAt: Date;
  lost: EntitlementLost | null;
}

/** Why a cancel or return no longer gives an entitlement back. */
export type EntitlementLost = 'expired' | 'closed';

const birthdayCouponSource: EntitlementSource = {
  type: 'birthday_coupon',
  active: birthdayEntitlements,
  hold: holdBirthdayCoupon,
  release: releaseBirthdayCoupon,
  held: heldBirthdayCoupon,
};

const upgradeRightSource: EntitlementSource = {
  type: 'upgrade_right',
  active: upgradeRightEntitlements,
  hold: holdUpgradeRight,
  release: releaseUpgradeRight,
  held: heldUpgradeRight,
};

const SOURCES: readonly EntitlementSource[] = [birthdayCouponSource, upgradeRightSource];

/** The Discount of an entitlement (not a promo code). */
export type EntitlementDiscount = Extract<Discount, { type: Entitlement['type'] }>;

export function isEntitlementDiscount(d: Discount | null): d is EntitlementDiscount {
  return d !== null && d.type !== 'promo_code';
}

/** The entitlement a quote's discount came from (the same type and id); null for a code or none. */
function entitlementOf(
  entitlements: readonly Entitlement[],
  d: Discount | null,
): Entitlement | null {
  if (!isEntitlementDiscount(d)) return null;
  return entitlements.find((e) => e.type === d.type && e.id === d.id) ?? null;
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

/**
 * The entitlement the order's Discount names, as the order holds it now (null when it holds none,
 * e.g. one a cancel or return already released): when it ends and whether a release now gives it back.
 */
export function heldEntitlement(
  tx: DbOrTx,
  discount: EntitlementDiscount,
  orderId: number,
  now: Date,
): Promise<HeldEntitlement | null> {
  return sourceOf(discount.type).held(tx, orderId, now);
}

/** ADR 0005: a cancelled or returned order gives back the entitlement it held while within validity. */
export async function releaseEntitlements(tx: DbOrTx, orderId: number, now: Date): Promise<void> {
  for (const s of SOURCES) await s.release(tx, orderId, now);
}

/**
 * The Entitlement an applied promo code keeps out (ADR 0002: an entered code wins): the one the
 * server would pick without the code, i.e. the cheapest entitlement among the quote's alternatives
 * (they come cheapest first, ties as `quote()` breaks them), with how much lower its total is
 * («Скидка за набор выгоднее на … сум», #39); null when none would discount the cart.
 */
export function entitlementWaitingBehindCode(
  q: Quote,
  entitlements: readonly Entitlement[],
): CartDto['entitlementWaiting'] {
  if (q.discount?.type !== 'promo_code') return null;
  for (const { discount, cheaperBy } of q.alternatives) {
    const e = entitlementOf(entitlements, discount);
    if (!e) continue;
    const terms = { ...termsOf(e), cheaperBy };
    return e.type === 'upgrade_right'
      ? { type: e.type, id: e.id, source: e.source, ...terms }
      : { type: e.type, id: e.id, ...terms };
  }
  return null;
}

/**
 * The chosen entitlement a quote found stale, by its source, so the cart can name it (#39):
 * «Купон ко дню рождения больше не действует — …». Null for any other choice.
 */
export async function lapsedDiscountOf(
  tx: DbOrTx,
  customerId: number,
  choice: DiscountChoice,
): Promise<CartDto['lapsedDiscount']> {
  if (choice.type === 'birthday_coupon') return { type: 'birthday_coupon' };
  if (choice.type !== 'upgrade_right') return null;
  const source = await readUpgradeRightSource(tx, customerId, choice.id);
  return source ? { type: 'upgrade_right', source } : null;
}

/** An entitlement's percent and last day (Tashkent), as «Мои скидки» and the cart name it. */
function termsOf(e: Entitlement): NonNullable<DiscountOptionDto['terms']> {
  return { percent: e.percent, lastDay: formatLocalDate(lastDayOf(e.expiresAt)) };
}

/**
 * The cart's discount switch (#39, ADR 0002), from the quote alone: the applied choice and every
 * alternative, plus «Не применять» (no discount, so the entitlements keep for a later order) while
 * a discount is applied. Cheapest total first, ties to the entitlement that ends first, then the
 * lowest id; «Не применять» always last. The order depends only on the options, never on which one
 * is applied, so a row stays where it was when the shopper taps it. Empty when there is nothing
 * to choose between: no discount at all, or just an applied code with no entitlement beside it
 * (its own field takes it out).
 */
export function discountOptionsOf(
  q: Quote,
  entitlements: readonly Entitlement[],
): DiscountOptionDto[] {
  const rows = [
    { discount: q.discount, deliveryFee: q.deliveryFee, total: q.total, applied: true },
    ...q.alternatives.map((a) => ({ ...a, applied: false })),
    ...(q.discount ? [{ discount: null, ...q.withoutDiscount, applied: false }] : []),
  ].map(({ discount, deliveryFee, total, applied }) => {
    const e = entitlementOf(entitlements, discount);
    return { discount, deliveryFee, total, applied, terms: e ? termsOf(e) : null, e };
  });
  const choosing =
    rows.length > 1 &&
    (rows.some((r) => r.e !== null) || rows.find((r) => r.applied)!.discount === null);
  if (!choosing) return [];
  const last = Number.MAX_SAFE_INTEGER;
  const key = (r: (typeof rows)[number]) => ({
    none: r.discount === null ? 1 : 0,
    expiry: r.e?.expiresAt.getTime() ?? last,
    id: r.e?.id ?? 0,
  });
  return rows
    .sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (
        ka.none - kb.none ||
        a.total - b.total ||
        ka.expiry - kb.expiry ||
        ka.id - kb.id ||
        (a.discount?.type ?? '').localeCompare(b.discount?.type ?? '')
      );
    })
    .map(({ e: _e, ...row }) => row);
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
