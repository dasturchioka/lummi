import { z } from 'zod';
import { adminOrdersQuerySchema, paymentStateSchema } from './admin-orders';
import { bilingualSchema } from './catalog';
import { ORDER_ACTIONS, findTransition, type OrderTransition } from './order-machine';
import type { OrderStatus } from './order-status';
import { orderStatusSchema } from './orders';

/**
 * The orders board («Воронка» / «Voronka», #52): the order statuses as columns in the funnel's
 * order, then the closed outcomes. Each column holds the orders now in that status.
 */
export const BOARD_STATUSES = [
  'awaiting_payment',
  'receipt_review',
  'payment_confirmed',
  'accepted',
  'assembling',
  'handed_to_bts',
  'delivered',
  'cancelled',
  'returned',
] as const satisfies readonly OrderStatus[];

/**
 * Columns whose orders are done with: they show only what reached the status in the last
 * `BOARD_RECENT_DAYS` Tashkent days (today included), newest first, so the board stays bounded.
 * The work columns before them show every order, the one waiting longest first.
 */
export const BOARD_HISTORY_STATUSES = [
  'delivered',
  'cancelled',
  'returned',
] as const satisfies readonly OrderStatus[];

/** How many Tashkent days the history columns look back (a UI constant, not a shop rule). */
export const BOARD_RECENT_DAYS = 14;
/** The most cards one column carries; the rest are counted and live in the list view. */
export const BOARD_COLUMN_LIMIT = 50;

export const isHistoryStatus = (status: OrderStatus) =>
  (BOARD_HISTORY_STATUSES as readonly OrderStatus[]).includes(status);

/**
 * The move a staff member makes by dragging an order from one status to another: the row of the
 * transitions table (ADR 0011) that goes there and that staff may make, or none. The board offers
 * only these targets; the server still decides.
 */
export function staffMove(from: OrderStatus, to: OrderStatus): OrderTransition | undefined {
  for (const action of ORDER_ACTIONS) {
    const row = findTransition(from, action);
    if (row && row.to === to && row.actors.includes('staff')) return row;
  }
  return undefined;
}

/** Every status a staff member may move an order to from `from`, in the board's order. */
export const staffTargets = (from: OrderStatus): OrderStatus[] =>
  BOARD_STATUSES.filter((to) => staffMove(from, to) !== undefined);

/**
 * `GET /admin/orders/board`: the list's filters that make sense on the board (the status is the
 * column, so it is not one of them).
 */
export const adminOrdersBoardQuerySchema = adminOrdersQuerySchema.pick({
  q: true,
  payment: true,
  from: true,
  to: true,
});
export type AdminOrdersBoardQuery = z.input<typeof adminOrdersBoardQuerySchema>;

const som = z.number().int().nonnegative();

/** One order on the board: enough to recognise it, see what it waits for and how long. */
export const adminBoardCardSchema = z.object({
  number: z.number().int(),
  status: orderStatusSchema,
  payment: paymentStateSchema,
  /** It ended paid (cancelled or returned) and its Refunds do not cover the payment yet (#40). */
  refundOwed: z.boolean(),
  /** When it reached its status: the last move, or the checkout for one never moved. */
  statusSince: z.string().datetime(),
  total: som,
  /** Bottles and sets, counted by quantity. */
  itemCount: z.number().int().nonnegative(),
  customer: z.object({ name: z.string() }),
  /** The BTS point's city as the snapshot holds it; null for a typed address (the region then). */
  city: z.string().nullable(),
  region: bilingualSchema,
  isGift: z.boolean(),
});
export type AdminBoardCardDto = z.infer<typeof adminBoardCardSchema>;

export const adminBoardColumnSchema = z.object({
  status: orderStatusSchema,
  /** Orders in the column (a history column: within its days), however many cards came along. */
  count: z.number().int().nonnegative(),
  /** Their totals added up, whole so'm. */
  sum: som,
  /** At most `limit`: the work columns oldest in status first, the history ones newest first. */
  cards: z.array(adminBoardCardSchema),
});
export type AdminBoardColumnDto = z.infer<typeof adminBoardColumnSchema>;

export const adminOrdersBoardSchema = z.object({
  /** The server's now: every «time in this status» is measured from it. */
  at: z.string().datetime(),
  recentDays: z.number().int().positive(),
  limit: z.number().int().positive(),
  /** One per status, in `BOARD_STATUSES` order. */
  columns: z.array(adminBoardColumnSchema),
});
export type AdminOrdersBoardDto = z.infer<typeof adminOrdersBoardSchema>;
