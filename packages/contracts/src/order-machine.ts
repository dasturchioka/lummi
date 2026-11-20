/**
 * The order status machine's vocabulary, zod-free like `order-status.ts` but its own module, so
 * the Mini App's first screen (which reads the statuses) does not carry the transition table:
 * only the lazy order screen does (ADR 0030 budget).
 */
import type { OrderStatus } from './order-status';

/**
 * Who moves an order (ADR 0011): the shopper, a staff member (owner or manager), the receipt AI,
 * or the system's sweeps. The same list as the audit log's actor types.
 */
export const ORDER_ACTOR_TYPES = ['customer', 'staff', 'ai', 'system'] as const;
export type OrderActorType = (typeof ORDER_ACTOR_TYPES)[number];

/** Every way an order changes status; each is a row (or rows) of `ORDER_TRANSITIONS`. */
export const ORDER_ACTIONS = [
  'submit_receipt',
  'confirm_payment',
  'reject_receipt',
  'payment_not_found',
  'accept',
  'start_assembly',
  'hand_to_bts',
  'deliver',
  'return',
  'cancel',
] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export interface OrderTransition {
  from: OrderStatus;
  action: OrderAction;
  to: OrderStatus;
  /** Who may make this move. */
  actors: readonly OrderActorType[];
}

/**
 * The allowed-transitions table (ADR 0011, 0006, 0012). Everything not listed is refused:
 * «Возвращён» and «Отменён» are terminal, fulfilment moves one step at a time, only a manager
 * rejects a receipt, and the shopper (or the expiry sweep) cancels only while unpaid.
 */
export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  {
    from: 'awaiting_payment',
    action: 'submit_receipt',
    to: 'receipt_review',
    actors: ['customer'],
  },
  {
    from: 'receipt_review',
    action: 'confirm_payment',
    to: 'payment_confirmed',
    actors: ['ai', 'staff'],
  },
  // a credit that came with no receipt, linked to the order by a manager (TZ §4: «Поступления без
  // чека … менеджер может привязать их к заказу вручную»): money on the card is what counts
  {
    from: 'awaiting_payment',
    action: 'confirm_payment',
    to: 'payment_confirmed',
    actors: ['staff'],
  },
  { from: 'receipt_review', action: 'reject_receipt', to: 'awaiting_payment', actors: ['staff'] },
  // the wait window ended with no fitting credit: not a rejection (ADR 0012)
  {
    from: 'receipt_review',
    action: 'payment_not_found',
    to: 'awaiting_payment',
    actors: ['system'],
  },
  { from: 'payment_confirmed', action: 'accept', to: 'accepted', actors: ['staff'] },
  { from: 'accepted', action: 'start_assembly', to: 'assembling', actors: ['staff'] },
  { from: 'assembling', action: 'hand_to_bts', to: 'handed_to_bts', actors: ['staff'] },
  { from: 'handed_to_bts', action: 'deliver', to: 'delivered', actors: ['staff'] },
  { from: 'delivered', action: 'return', to: 'returned', actors: ['staff'] },
  {
    from: 'awaiting_payment',
    action: 'cancel',
    to: 'cancelled',
    actors: ['customer', 'staff', 'system'],
  },
  { from: 'receipt_review', action: 'cancel', to: 'cancelled', actors: ['staff'] },
  { from: 'payment_confirmed', action: 'cancel', to: 'cancelled', actors: ['staff'] },
  { from: 'accepted', action: 'cancel', to: 'cancelled', actors: ['staff'] },
  { from: 'assembling', action: 'cancel', to: 'cancelled', actors: ['staff'] },
  { from: 'handed_to_bts', action: 'cancel', to: 'cancelled', actors: ['staff'] },
];

/** The row for `action` from `from`, if that move exists at all. */
export function findTransition(
  from: OrderStatus,
  action: OrderAction,
): OrderTransition | undefined {
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.action === action);
}

/** Staff may make this move from that status: the order page's buttons and the board's drag read it. */
export const staffMay = (from: OrderStatus, action: OrderAction): boolean =>
  findTransition(from, action)?.actors.includes('staff') ?? false;

/**
 * Paid: the payment was confirmed. Money only goes back to a paid order's shopper, as a Refund
 * (ADR 0006), so cancelling one of these tells them the manager will be in touch.
 */
export const PAID_STATUSES: readonly OrderStatus[] = [
  'payment_confirmed',
  'accepted',
  'assembling',
  'handed_to_bts',
  'delivered',
  'returned',
];

/** The shopper may cancel their own order only while «Ожидает оплаты» (ADR 0011). */
export function customerMayCancel(status: OrderStatus): boolean {
  return findTransition(status, 'cancel')?.actors.includes('customer') ?? false;
}

/**
 * Why an order was cancelled (a Cancellation always has one). The shopper's own, the expiry
 * sweep's, and the TZ §6 list a manager picks from.
 */
export const CANCEL_REASONS = [
  'customer_cancelled',
  'reserve_expired',
  'out_of_stock',
  'customer_refused',
  'unreachable',
  'payment_not_received',
  'not_collected_at_bts',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** The reasons each actor may give. */
export const CANCEL_REASONS_BY_ACTOR: Record<OrderActorType, readonly CancelReason[]> = {
  customer: ['customer_cancelled'],
  system: ['reserve_expired'],
  staff: [
    'out_of_stock',
    'customer_refused',
    'unreachable',
    'payment_not_received',
    'not_collected_at_bts',
  ],
  ai: [],
};

/** «Не забрал в BTS» fits only a parcel that was handed over and came back (ADR 0006). */
export const CANCEL_REASON_ONLY_FROM: Partial<Record<CancelReason, OrderStatus>> = {
  not_collected_at_bts: 'handed_to_bts',
};

/**
 * The reasons `actor` may cancel with from `from`: theirs, less any that fits only another status.
 * The one rule the machine, the admin's cancel dialog and the orders group's buttons read.
 */
export function cancelReasonsFor(actor: OrderActorType, from: OrderStatus): CancelReason[] {
  return CANCEL_REASONS_BY_ACTOR[actor].filter((r) => {
    const only = CANCEL_REASON_ONLY_FROM[r];
    return !only || only === from;
  });
}

/** The longest note staff add to a cancel (kept in the history only); the dialog reads it too. */
export const CANCEL_NOTE_MAX = 500;

/** The longest reason staff type for a return or a refund (#40); the dialogs read it too. */
export const TYPED_REASON_MAX = 500;

/**
 * BTS's tracking number for «Передан в BTS», checked loosely (spec Changes 2026-11-11): its format
 * is BTS's, so only surrounding space is trimmed and a minimum length catches a slip of the finger.
 */
export const TRACKING_NUMBER_MIN = 6;
export const TRACKING_NUMBER_MAX = 64;

/** Why `POST /orders/:number/cancel` (or another move) was refused. */
export const TRANSITION_REFUSALS = ['not_allowed', 'forbidden', 'invalid_payload'] as const;
export type TransitionRefusal = (typeof TRANSITION_REFUSALS)[number];
