import { PAID_STATUSES, type OrderAction, type TransitionPayload } from '@lummi/contracts';
import type { OrderLineRow, OrderRow, orders } from '@lummi/db';
import { fill, formatMoney, type Language } from '@lummi/i18n';
import { botMessages } from '@lummi/i18n/bot';
import { ordersMessages } from '@lummi/i18n/orders';
import type { OnHandMove } from './on-hand';

/** One move as `transition()` is about to make it. */
export interface Move<A extends OrderAction> {
  /** The order as locked, before the move: its status is the one it leaves. */
  order: OrderRow;
  lines: readonly OrderLineRow[];
  payload: TransitionPayload<A>;
}

/** The shopper's message text, and whether it carries «Написать менеджеру». */
export interface ShopperText {
  text: string;
  manager?: boolean;
}

/**
 * Everything a move does besides changing the status, in one place per action, so each payment
 * and fulfilment ticket (#28 #32 #33 #36 #37 #40) extends its own row instead of a switch here
 * and an if-chain there.
 */
export interface Effects<A extends OrderAction> {
  /** The audit action, labelled RU/UZ in the admin's audit log. */
  audit: string;
  /** A payload check that needs the order's lines; false refuses the move (`invalid_payload`). */
  fits?: (m: Move<A>) => boolean;
  /**
   * On hand (ADR 0010). Present on every move that ends the reserve or touches on hand: the
   * order's on-hand rows are locked first, then the returned lines move (none: the lock only).
   */
  onHand?: (m: Move<A>) => OnHandMove;
  /** ADR 0005: release the discount source the order held; a return also closes the rights it opened. */
  discountSource?: 'release' | 'release_and_close_rights';
  /** Columns the move sets on the order besides its status. */
  columns?: (m: Move<A>) => Partial<typeof orders.$inferInsert>;
  /** The shopper's message (spec Changes 2026-11-07); none for «Принят» and none for a return. */
  message: (m: Move<A>, language: Language) => ShopperText | null;
}

const bot = (language: Language) => botMessages[language].bot;
const number = (m: Move<OrderAction>) => String(m.order.number);
const paid = (m: Move<OrderAction>) => PAID_STATUSES.includes(m.order.status);

/** A return's flags name every line of the order exactly once (ADR 0006). */
function flagsNameEveryLine(m: Move<'return'>): boolean {
  const positions = m.payload.lines.map((f) => f.position);
  return (
    new Set(positions).size === positions.length &&
    positions.length === m.lines.length &&
    m.lines.every((l) => positions.includes(l.position))
  );
}

export const EFFECTS: { [A in OrderAction]: Effects<A> } = {
  submit_receipt: {
    audit: 'order.receipt_submitted',
    message: (m, lang) => ({ text: fill(bot(lang).receiptReceived, { number: number(m) }) }),
  },
  confirm_payment: {
    audit: 'order.payment_confirmed',
    // with a receipt the order is «Чек на проверке», a credit with none confirms «Ожидает оплаты»;
    // the recorded amounts are this order's, and a credit that differs always carries its reason
    fits: (m) =>
      (m.payload.receiptId === null) === (m.order.status === 'awaiting_payment') &&
      m.payload.amountDue === m.order.amountDue &&
      m.payload.differenceTiyin === m.payload.creditAmountTiyin - m.order.amountDue * 100 &&
      (m.payload.reason !== undefined ||
        (m.payload.differenceTiyin === 0 && !m.payload.offShopCard)),
    // the link itself; `orders_credit_idx` keeps a credit to one order whatever wrote the row
    columns: (m) => ({ creditId: m.payload.creditId }),
    message: (m, lang) => ({ text: fill(bot(lang).paymentConfirmed, { number: number(m) }) }),
  },
  reject_receipt: {
    audit: 'order.receipt_rejected',
    message: (m, lang) => ({
      text: fill(bot(lang).receiptRejected, { number: number(m), reason: m.payload.reason }),
      manager: true,
    }),
  },
  payment_not_found: {
    audit: 'order.payment_not_found',
    message: (m, lang) => ({
      text: fill(bot(lang).paymentNotFound, {
        number: number(m),
        amount: formatMoney(m.order.amountDue, lang),
      }),
      manager: true,
    }),
  },
  accept: {
    audit: 'order.accepted',
    message: () => null,
  },
  start_assembly: {
    audit: 'order.assembling',
    message: (m, lang) => ({ text: fill(bot(lang).assembling, { number: number(m) }) }),
  },
  hand_to_bts: {
    audit: 'order.handed_to_bts',
    // the bottles leave the warehouse: the reserve ends and on hand drops together
    onHand: (m) => ({ lines: m.lines, sign: -1 }),
    columns: (m) => ({ trackingNumber: m.payload.trackingNumber }),
    message: (m, lang) => ({
      text: fill(bot(lang).handedToBts, {
        number: number(m),
        tracking: m.payload.trackingNumber,
      }),
    }),
  },
  deliver: {
    audit: 'order.delivered',
    message: (m, lang) => ({ text: fill(bot(lang).delivered, { number: number(m) }) }),
  },
  return: {
    audit: 'order.returned',
    fits: flagsNameEveryLine,
    // only the lines flagged back to stock; a leaking bottle stays off the shelf
    onHand: (m) => ({
      lines: m.lines.filter(
        (l) => m.payload.lines.find((f) => f.position === l.position)?.backToStock,
      ),
      sign: 1,
    }),
    discountSource: 'release_and_close_rights',
    message: () => null,
  },
  cancel: {
    audit: 'order.cancelled',
    // before handover the reserve just ends; a parcel back from BTS goes back on hand
    onHand: (m) => ({ lines: m.order.status === 'handed_to_bts' ? m.lines : [], sign: 1 }),
    discountSource: 'release',
    // a paid order's money goes back as a Refund (ADR 0006): the manager will be in touch
    message: (m, lang) => {
      const t = bot(lang);
      const text = fill(t.orderCancelled, {
        number: number(m),
        reason: ordersMessages[lang].orders.cancelReason[m.payload.reason],
      });
      return paid(m) ? { text: `${text}\n${t.refundNote}`, manager: true } : { text };
    },
  },
};
