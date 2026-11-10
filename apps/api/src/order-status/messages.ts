import type { CustomerRow, OrderRow } from '@lummi/db';
import { fill, formatDateTime, formatMoney } from '@lummi/i18n';
import { botMessages } from '@lummi/i18n/bot';
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

/**
 * A message to the shopper about one order, in their language, with «Открыть заказ» and, when
 * `managerUsername` is given, «Написать менеджеру». Delivery respects `bot_blocked` and a refused
 * write access (the outbox suppresses those).
 */
export function orderMessage(
  c: Recipient,
  order: Pick<OrderRow, 'number'>,
  text: string,
  links: MessageLinks,
): OutboxMessage {
  const t = botMessages[c.language].bot;
  const rows: Button[][] = [];
  if (links.miniAppUrl)
    rows.push([{ text: t.openOrder, web_app: { url: orderUrl(links.miniAppUrl, order.number) } }]);
  if (links.managerUsername)
    rows.push([
      { text: t.writeManager, url: `https://t.me/${links.managerUsername.replace(/^@/, '')}` },
    ]);
  return {
    chatId: c.telegramId,
    text,
    options: rows.length > 0 ? { reply_markup: { inline_keyboard: rows } } : {},
  };
}

/** «Бронь действует до …»: sent once, some hours before `reserve_until`, while the order waits for payment. */
export function reserveReminder(c: Recipient, order: OrderRow, links: MessageLinks): OutboxMessage {
  const t = botMessages[c.language].bot;
  return orderMessage(
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
