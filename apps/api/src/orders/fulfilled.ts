import { eq, orders, type SQL } from '@lummi/db';
import type { OrderStatus } from '@lummi/contracts';

/**
 * A Fulfilled order (GLOSSARY): it reached «Доставлен» and was not returned. The one place that
 * decides it, so every total that counts "what the customer actually bought" (the customers list,
 * later the reports and the birthday and loyalty rules) agrees.
 *
 * A return is its own status today (`returned`, ADR 0011), so «Доставлен» alone is "not returned".
 * When a return can happen to a part of an order (#40), extend these two in step.
 */
export function isFulfilled(status: OrderStatus): boolean {
  return status === 'delivered';
}

/** The same rule as a SQL condition over `orders`, for sums and counts. */
export const fulfilledOrder: SQL = eq(orders.status, 'delivered');
