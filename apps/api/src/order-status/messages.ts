import type { OrderAction, TransitionPayload } from '@lummi/contracts';
import type { CustomerRow, OrderRow } from '@lummi/db';
import { fill, formatDateTime, formatMoney } from '@lummi/i18n';
import { botMessages } from '@lummi/i18n/bot';
import { ordersMessages } from '@lummi/i18n/orders';
import type { OutboxMessage } from '../outbox/outbox.service';
import { orderUrl } from '../orders/orders.service';

type Recipient = Pick<CustomerRow, 'telegramId' | 'language'>;
type Button = { text: string; web_app: { url: string } } | { text: string; url: string };

export interface MessageLinks {
  /** The Mini App's URL (env `MINIAPP_URL`): «Открыть заказ» opens the order there. */
  miniAppUrl?: string;
  /** `shop.managerUsername`, for «Написать менеджеру» where the message asks the shopper to act. */
  managerUsername?: string;
}

function message(
  c: Recipient,
  order: OrderRow,
  text: string,
  links: MessageLinks,
  withManager = false,
): OutboxMessage {
  const t = botMessages[c.language].bot;
  const rows: Button[][] = [];
  if (links.miniAppUrl)
    rows.push([{ text: t.openOrder, web_app: { url: orderUrl(links.miniAppUrl, order.number) } }]);
  if (withManager && links.managerUsername)
    rows.push([
      { text: t.writeManager, url: `https://t.me/${links.managerUsername.replace(/^@/, '')}` },
    ]);
  return {
    chatId: c.telegramId,
    text,
    options: rows.length > 0 ? { reply_markup: { inline_keyboard: rows } } : {},
  };
}

/**
 * The shopper's message for a status change, in their language with «Открыть заказ» (spec
 * Changes 2026-11-07, customer messages). None for «Принят» and none for a return. Delivery
 * respects `bot_blocked` and a refused write access (the outbox suppresses those).
 */
export function statusMessage<A extends OrderAction>(
  c: Recipient,
  order: OrderRow,
  action: A,
  payload: TransitionPayload<A>,
  links: MessageLinks,
): OutboxMessage | null {
  const t = botMessages[c.language].bot;
  const number = String(order.number);
  const send = (text: string, withManager = false) => message(c, order, text, links, withManager);
  switch (action) {
    case 'submit_receipt':
      return send(fill(t.receiptReceived, { number }));
    case 'confirm_payment':
      return send(fill(t.paymentConfirmed, { number }));
    case 'reject_receipt': {
      const { reason } = payload as TransitionPayload<'reject_receipt'>;
      return send(fill(t.receiptRejected, { number, reason }), true);
    }
    case 'payment_not_found':
      return send(
        fill(t.paymentNotFound, { number, amount: formatMoney(order.amountDue, c.language) }),
        true,
      );
    case 'start_assembly':
      return send(fill(t.assembling, { number }));
    case 'hand_to_bts': {
      const { trackingNumber } = payload as TransitionPayload<'hand_to_bts'>;
      return send(fill(t.handedToBts, { number, tracking: trackingNumber }));
    }
    case 'deliver':
      return send(fill(t.delivered, { number }));
    case 'cancel': {
      const { reason } = payload as TransitionPayload<'cancel'>;
      const why = ordersMessages[c.language].orders.cancelReason[reason];
      return send(fill(t.orderCancelled, { number, reason: why }));
    }
    case 'accept':
    case 'return':
      return null;
  }
  return null;
}

/** «Бронь заканчивается»: sent once, some hours before `reserve_until`, while no receipt is under check. */
export function reserveReminder(c: Recipient, order: OrderRow, links: MessageLinks): OutboxMessage {
  const t = botMessages[c.language].bot;
  return message(
    c,
    order,
    fill(t.reserveReminder, {
      number: String(order.number),
      until: formatDateTime(order.reserveUntil, c.language),
      amount: formatMoney(order.amountDue, c.language),
    }),
    links,
  );
}
