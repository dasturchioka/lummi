import {
  formatLocalDate,
  lastDayOf,
  PAID_STATUSES,
  type OrderAction,
  type TransitionPayload,
} from '@lummi/contracts';
import type { OrderLineRow, OrderRow, orders, UpgradeRightRow } from '@lummi/db';
import { fill, formatCalendarDate, formatDateTime, formatMoney, type Language } from '@lummi/i18n';
import { botMessages, orderCancelledText, receiptRejectedText } from '@lummi/i18n/bot';
import type { OnHandMove } from './on-hand';

/** One move as `transition()` is about to make it. */
export interface Move<A extends OrderAction> {
  /** The order as locked, before the move: its status is the one it leaves. */
  order: OrderRow;
  lines: readonly OrderLineRow[];
  payload: TransitionPayload<A>;
  /** The upgrade rights this move opened (only «Доставлен» opens any, #38); empty otherwise. */
  openedRights: readonly Pick<UpgradeRightRow, 'source' | 'percent' | 'expiresAt'>[];
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
  /**
   * What the move does to discount sources (`DiscountSourceHooks`, ADR 0003, 0005): a cancel
   * releases the one the order held; a return releases it and closes the upgrade rights the order
   * opened; delivery opens them.
   */
  discountSource?: 'release' | 'release_and_close_rights' | 'open_rights';
  /** Columns the move sets on the order besides its status. */
  columns?: (m: Move<A>) => Partial<typeof orders.$inferInsert>;
  /** The shopper's message (spec Changes 2026-11-07); none for «Принят» and none for a return. */
  message: (m: Move<A>, language: Language) => ShopperText | null;
}

const bot = (language: Language) => botMessages[language].bot;
const number = (m: Move<OrderAction>) => String(m.order.number);
const paid = (m: Move<OrderAction>) => PAID_STATUSES.includes(m.order.status);

/**
 * The reserve of an order going back to «Ожидает оплаты» from «Чек на проверке»: as it was, plus
 * the time the payment feed was paused while its receipt waited (ADR 0012, #36). The one
 * computation: the moves' columns and `PaymentNotFound` (to tell whether it has ended) use it.
 */
export function extendReserve(reserveUntil: Date, pausedSeconds: number): Date {
  return new Date(reserveUntil.getTime() + pausedSeconds * 1000);
}
const extendedReserve = (m: Move<'payment_not_found' | 'reject_receipt'>) =>
  extendReserve(m.order.reserveUntil, m.payload.pausedSeconds);

/** «Вам открыта скидка …»: the first right the move opened, a set's before a 10 ml bottle's. */
function rightOpened(m: Move<OrderAction>, lang: Language): string | null {
  const r = m.openedRights.find((x) => x.source === 'set') ?? m.openedRights[0];
  if (!r) return null;
  return fill(bot(lang).upgradeRightOpened[r.source], {
    percent: String(r.percent),
    until: formatCalendarDate(formatLocalDate(lastDayOf(r.expiresAt)), lang),
  });
}

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
    // a paused Humo feed does not eat the reserve of an order under check (ADR 0012, #36)
    columns: (m) => ({ reserveUntil: extendedReserve(m) }),
    // the preset reads as a sentence in the shopper's language, the manager's note under it (#33)
    message: (m, lang) => ({
      text: receiptRejectedText(lang, m.order.number, m.payload.reason, m.payload.note),
      manager: true,
    }),
  },
  payment_not_found: {
    audit: 'order.payment_not_found',
    // a paused Humo feed does not eat the reserve of an order under check (ADR 0012, #36)
    columns: (m) => ({ reserveUntil: extendedReserve(m) }),
    message: (m, lang) => {
      const t = bot(lang);
      const text = m.payload.reserveEnded
        ? t.paymentNotFoundReserveEnded
        : m.payload.duplicateOf !== null
          ? t.paymentNotFoundDuplicate
          : t.paymentNotFound;
      return {
        text: fill(text, {
          number: number(m),
          amount: formatMoney(m.order.amountDue, lang),
          until: formatDateTime(extendedReserve(m), lang),
        }),
        manager: true,
      };
    },
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
    // a delivered set (or single 10 ml bottle, once switched on) opens its upgrade rights (#38)
    discountSource: 'open_rights',
    // and says so in one more line, so the shopper hears of it before the first reminder
    message: (m, lang) => ({
      text: [fill(bot(lang).delivered, { number: number(m) }), rightOpened(m, lang)]
        .filter((line) => line !== null)
        .join('\n'),
    }),
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
      const text = orderCancelledText(lang, m.order.number, m.payload.reason, paid(m));
      return paid(m) ? { text, manager: true } : { text };
    },
  },
};
