/**
 * Order vocabulary without zod, so the Mini App (`@lummi/contracts/client`) and the DB schema
 * (`order_status` enum) share one list with the API contract.
 */

/** One linear order status (ADR 0011). Checkout creates «Ожидает оплаты»; the status machine (#24) moves it on. */
export const ORDER_STATUSES = [
  'awaiting_payment',
  'receipt_review',
  'payment_confirmed',
  'accepted',
  'assembling',
  'handed_to_bts',
  'delivered',
  'returned',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Why checkout refused the input (422). */
export const ORDER_INPUT_ERRORS = [
  'consent_required',
  'unknown_point',
  'unknown_region',
  'gift_message_too_long',
  'invalid_recipient_phone',
] as const;
export type OrderInputError = (typeof ORDER_INPUT_ERRORS)[number];

/** Why checkout answered 409: the shopper's view is stale, or the database asks to try again. */
export const CHECKOUT_CONFLICTS = ['total_changed', 'nothing_to_order'] as const;
export type CheckoutConflictCode = (typeof CHECKOUT_CONFLICTS)[number];

/** The «Заказы» list's page size: the default and the most one request may ask for. */
export const ORDERS_PAGE_DEFAULT = 20;
export const ORDERS_PAGE_MAX = 50;

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
  { from: 'awaiting_payment', action: 'submit_receipt', to: 'receipt_review', actors: ['customer'] },
  {
    from: 'receipt_review',
    action: 'confirm_payment',
    to: 'payment_confirmed',
    actors: ['ai', 'staff'],
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
export function findTransition(from: OrderStatus, action: OrderAction): OrderTransition | undefined {
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.action === action);
}

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

/** Why `POST /orders/:number/cancel` (or another move) was refused. */
export const TRANSITION_REFUSALS = ['not_allowed', 'forbidden', 'invalid_payload'] as const;
export type TransitionRefusal = (typeof TRANSITION_REFUSALS)[number];
