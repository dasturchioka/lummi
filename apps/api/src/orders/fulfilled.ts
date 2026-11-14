import type { OrderStatus } from '@lummi/contracts';
import { inArray, orderEvents, orders, sql, type SQL } from '@lummi/db';

/**
 * Fulfilled order (GLOSSARY): it reached «Доставлен» and was not returned. The one list that
 * decides it, so every total that counts "what the customer actually bought" (the customers list,
 * later the reports and the birthday and loyalty rules) agrees.
 *
 * A Return takes back the whole order into its own status (`returned`, ADR 0006, 0011; #40), so
 * «Доставлен» alone is "not returned". A Refund changes no status: a refunded order stays
 * fulfilled, and reports subtract its refunds (#42).
 */
export const FULFILLED_STATUSES = ['delivered'] as const satisfies readonly OrderStatus[];

export function isFulfilled(status: OrderStatus): boolean {
  return (FULFILLED_STATUSES as readonly OrderStatus[]).includes(status);
}

/** The same rule as a SQL condition over `orders`. */
export const fulfilledOrder: SQL = inArray(orders.status, [...FULFILLED_STATUSES]);

/**
 * When an order became Fulfilled: its first move into a fulfilled status (the «Доставлен» event of
 * its history, ADR 0011), null for an order that never got there. The sales report counts an
 * order on this instant's Tashkent day (#42). A subquery for a select over `orders`; the outer row
 * is named in full, since drizzle leaves a lone table's columns unqualified.
 */
export const fulfilledAt =
  sql<Date | null>`(select min(ev.created_at) from ${orderEvents} ev where ev.order_id = "orders"."id" and ev.to_status in (${sql.join(
    FULFILLED_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  )}))`.mapWith(orderEvents.createdAt);

/** What a customer spent: the sum of their Fulfilled orders' totals, 0 when there are none. */
export const fulfilledTotal =
  sql<number>`coalesce(sum(${orders.total}) filter (where ${fulfilledOrder}), 0)`.mapWith(Number);
