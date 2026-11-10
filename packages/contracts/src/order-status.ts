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
  /** «Купить сейчас» named a fragrance or set that is unknown or no longer sold (hidden). */
  'unknown_item',
] as const;
export type OrderInputError = (typeof ORDER_INPUT_ERRORS)[number];

/**
 * The orders «Повторить заказ» is offered on (#25 ruling): one that reached «Доставлен», or ended
 * «Отменён» (the shopper's own cancel, staff's or the reserve expiry). Never one still on its way
 * or awaiting payment; the server refuses those with 409 `not_repeatable`.
 */
export const REPEATABLE_STATUSES = ['delivered', 'cancelled'] as const satisfies readonly OrderStatus[];
export const orderRepeatable = (status: OrderStatus): boolean =>
  (REPEATABLE_STATUSES as readonly OrderStatus[]).includes(status);

/**
 * Why «Повторить заказ» put fewer units of a line in the cart than the order had: none available
 * (`sold_out`), a builder set one of whose five 10 ml is short (`set_incomplete`), fewer available
 * than ordered (`capped`), or the cart line reached its 99 ceiling (`max_qty`).
 */
export const REPEAT_SHORT_REASONS = ['sold_out', 'set_incomplete', 'capped', 'max_qty'] as const;
export type RepeatShortReason = (typeof REPEAT_SHORT_REASONS)[number];

/** Why checkout answered 409: the shopper's view is stale, or the database asks to try again. */
export const CHECKOUT_CONFLICTS = ['total_changed', 'nothing_to_order'] as const;
export type CheckoutConflictCode = (typeof CHECKOUT_CONFLICTS)[number];

/** The «Заказы» list's page size: the default and the most one request may ask for. */
export const ORDERS_PAGE_DEFAULT = 20;
export const ORDERS_PAGE_MAX = 50;
