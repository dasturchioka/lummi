import type { OrderStatus } from '@lummi/contracts';
import { inArray, orders, sql, type SQL } from '@lummi/db';

/**
 * Fulfilled order (GLOSSARY): it reached «Доставлен» and was not returned. The one list that
 * decides it, so every total that counts "what the customer actually bought" (the customers list,
 * later the reports and the birthday and loyalty rules) agrees.
 *
 * A return is its own status today (`returned`, ADR 0011), so «Доставлен» alone is "not returned".
 * When a return can happen to a part of an order (#40), change this one line.
 */
export const FULFILLED_STATUSES = ['delivered'] as const satisfies readonly OrderStatus[];

export function isFulfilled(status: OrderStatus): boolean {
  return (FULFILLED_STATUSES as readonly OrderStatus[]).includes(status);
}

/** The same rule as a SQL condition over `orders`. */
export const fulfilledOrder: SQL = inArray(orders.status, [...FULFILLED_STATUSES]);

/** What a customer spent: the sum of their Fulfilled orders' totals, 0 when there are none. */
export const fulfilledTotal =
  sql<number>`coalesce(sum(${orders.total}) filter (where ${fulfilledOrder}), 0)`.mapWith(Number);
