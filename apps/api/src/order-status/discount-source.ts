import type { DbOrTx, OrderRow } from '@lummi/db';

/**
 * ADR 0005 seam, the pair of the hold in `OrdersService.createOrder`: an order that is cancelled,
 * or returned as a whole, releases the discount source it held, in the transaction of that status
 * change. An upgrade right (#38) or a birthday coupon (#30) has its `used_by_order_id` cleared and
 * is active again while still within its validity, otherwise lost; a promo-code use (#29) is
 * voided. A no-op until those tickets fill it: no order holds a source yet.
 */
export async function releaseDiscountSource(_tx: DbOrTx, _order: OrderRow): Promise<void> {}

/**
 * ADR 0005: a returned **source** order (a set, or a 10 ml bottle once approved) closes the
 * upgrade rights it opened; one already spent stays with the order that used it (no clawback).
 * A no-op until #38 / #40 fill it.
 */
export async function closeRightsOpenedBy(_tx: DbOrTx, _order: OrderRow): Promise<void> {}
