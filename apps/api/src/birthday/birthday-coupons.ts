import type { BirthdayCouponDto, CartDto, Quote } from '@lummi/contracts';
import { and, asc, birthdayCoupons, eq, gt, isNull, type DbOrTx } from '@lummi/db';
import type { Entitlement } from '../pricing/quote';
import { readSettings } from '../settings/settings.service';
import { daysLeft, formatLocalDate, lastDayOf, type BirthdayRules } from './birthday-dates';

/**
 * Birthday coupons as orders and the cart see them (ticket #30, ADR 0005): the customer's active
 * ones as `quote()` takes them, the hold `createOrder` makes with a conditional update, and the
 * release a cancel or return makes. Their state is derived, never stored: active while no order
 * holds them and `expires_at` has not come. The money itself is `quote()`'s.
 */

/** The settings the calendar reads. */
export async function readBirthdayRules(tx: DbOrTx): Promise<BirthdayRules> {
  const s = await readSettings(tx, [
    'birthday.daysBefore',
    'birthday.daysAfter',
    'birthday.firstCouponAfterDays',
    'birthday.issueHour',
  ]);
  return {
    daysBefore: s['birthday.daysBefore'],
    daysAfter: s['birthday.daysAfter'],
    firstCouponAfterDays: s['birthday.firstCouponAfterDays'],
    issueHour: s['birthday.issueHour'],
  };
}

/** The customer's coupons no order holds and still within validity, soonest to end first. */
export async function activeBirthdayCoupons(tx: DbOrTx, customerId: number, now: Date) {
  return tx
    .select()
    .from(birthdayCoupons)
    .where(
      and(
        eq(birthdayCoupons.customerId, customerId),
        isNull(birthdayCoupons.usedByOrderId),
        gt(birthdayCoupons.expiresAt, now),
      ),
    )
    .orderBy(asc(birthdayCoupons.expiresAt), asc(birthdayCoupons.id));
}

/** The active coupons as `quote()` takes them: percent and cap as issued. */
export async function birthdayEntitlements(
  tx: DbOrTx,
  customerId: number,
  now: Date,
): Promise<Extract<Entitlement, { type: 'birthday_coupon' }>[]> {
  const rows = await activeBirthdayCoupons(tx, customerId, now);
  return rows.map((c) => ({
    type: 'birthday_coupon' as const,
    id: c.id,
    percent: c.percent,
    maxAmount: c.maxAmount,
    expiresAt: c.expiresAt,
  }));
}

/**
 * The birthday coupon an applied promo code keeps out (ADR 0002: an entered code wins), when the
 * quote lists it as an alternative that would discount this cart; null otherwise.
 */
export function couponWaitingBehindCode(
  q: Quote,
  entitlements: readonly Entitlement[],
): CartDto['birthdayCouponWaiting'] {
  if (q.discount?.type !== 'promo_code') return null;
  for (const alt of q.alternatives) {
    if (alt.discount.type !== 'birthday_coupon') continue;
    const id = alt.discount.id;
    const coupon = entitlements.find((e) => e.type === 'birthday_coupon' && e.id === id);
    if (coupon)
      return {
        id,
        percent: coupon.percent,
        lastDay: formatLocalDate(lastDayOf(coupon.expiresAt)),
      };
  }
  return null;
}

/** An active coupon as Profile shows it. */
export function toCouponDto(
  c: { id: number; percent: number; maxAmount: number; expiresAt: Date },
  now: Date,
): BirthdayCouponDto {
  const lastDay = lastDayOf(c.expiresAt);
  return {
    id: c.id,
    percent: c.percent,
    maxAmount: c.maxAmount,
    lastDay: formatLocalDate(lastDay),
    daysLeft: daysLeft(lastDay, now),
  };
}

/**
 * ADR 0005: the order holds the coupon, `UPDATE … WHERE used_by_order_id IS NULL AND expires_at >
 * now`, in the transaction that creates it. False when another order holds it or it has expired.
 */
export async function holdBirthdayCoupon(
  tx: DbOrTx,
  hold: { id: number; customerId: number; orderId: number; now: Date },
): Promise<boolean> {
  const held = await tx
    .update(birthdayCoupons)
    .set({ usedByOrderId: hold.orderId })
    .where(
      and(
        eq(birthdayCoupons.id, hold.id),
        eq(birthdayCoupons.customerId, hold.customerId),
        isNull(birthdayCoupons.usedByOrderId),
        gt(birthdayCoupons.expiresAt, hold.now),
      ),
    )
    .returning({ id: birthdayCoupons.id });
  return held.length === 1;
}

/**
 * A cancelled or returned order gives its coupon back while it is still within validity (ADR 0005:
 * «в пределах срока»), so it is active again. Past its end it is lost and stays with the order that
 * used it, the record of where it went.
 */
export async function releaseBirthdayCoupon(tx: DbOrTx, orderId: number, now: Date): Promise<void> {
  await tx
    .update(birthdayCoupons)
    .set({ usedByOrderId: null })
    .where(and(eq(birthdayCoupons.usedByOrderId, orderId), gt(birthdayCoupons.expiresAt, now)));
}
