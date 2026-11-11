import {
  CANCEL_REASON_ONLY_FROM,
  CANCEL_REASONS,
  CANCEL_REASONS_BY_ACTOR,
  ORDER_STATUSES,
  type CancelReason,
  type OrderAction,
  type OrderStatus,
} from '@lummi/contracts';
import type { OrderCardPanel, OrderLineRow, OrderRow } from '@lummi/db';
import {
  fill,
  formatDayMonth,
  formatMoney,
  formatPhone,
  formatTime,
  type Language,
} from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';

/** Telegram's limit on a message's text, counted after the HTML is parsed (UTF-16 units). */
export const MESSAGE_MAX = 4096;
/** Telegram's limit on callback data, in bytes. */
export const CALLBACK_DATA_MAX = 64;

/** The fulfilment step a card offers from each status (ADR 0011): one at a time. */
export const NEXT_STEP = {
  payment_confirmed: 'accept',
  accepted: 'start_assembly',
  assembling: 'hand_to_bts',
  handed_to_bts: 'deliver',
} as const satisfies Partial<Record<OrderStatus, OrderAction>>;
export type StepStatus = keyof typeof NEXT_STEP;
export type StepAction = (typeof NEXT_STEP)[StepStatus];
export const isStepStatus = (s: OrderStatus): s is StepStatus => s in NEXT_STEP;

/**
 * A button on the card. Its callback data carries the order and the status the card showed, so a
 * press on a card that has moved on is caught by `transition()`'s expected status.
 * - `next`: the next step; `cancel`: show the reasons; `reason`: ask to confirm that reason;
 * - `confirm`: cancel with it; `back`: the steps again.
 */
export type CardPress =
  | { verb: 'next' | 'cancel' | 'back'; orderId: number; expected: OrderStatus }
  | { verb: 'reason' | 'confirm'; orderId: number; expected: OrderStatus; reason: CancelReason };

const VERB_CODE = { next: 'n', cancel: 'c', reason: 'r', confirm: 'y', back: 'b' } as const;
const CODE_VERB = Object.fromEntries(Object.entries(VERB_CODE).map(([v, c]) => [c, v])) as Record<
  string,
  CardPress['verb']
>;

/** The namespace of the card's buttons (#31 owns `rcpt:`). */
export const CARD_CALLBACK = /^ord:/;

/** `ord:<verb>:<order id>:<expected status>[:<reason>]`, at most 61 bytes. */
export function encodePress(p: CardPress): string {
  const base = `ord:${VERB_CODE[p.verb]}:${p.orderId}:${p.expected}`;
  return 'reason' in p ? `${base}:${p.reason}` : base;
}

/** The press a button's data names, or null for anything else (an old or forged button). */
export function decodePress(data: string): CardPress | null {
  const m = /^ord:([a-z]):(\d{1,16}):([a-z_]{1,32})(?::([a-z_]{1,32}))?$/.exec(data);
  if (!m) return null;
  const verb = CODE_VERB[m[1]!];
  const orderId = Number(m[2]);
  const expected = m[3] as OrderStatus;
  if (!verb || !Number.isSafeInteger(orderId) || orderId < 1) return null;
  if (!ORDER_STATUSES.includes(expected)) return null;
  if (verb === 'reason' || verb === 'confirm') {
    const reason = m[4] as CancelReason | undefined;
    if (!reason || !CANCEL_REASONS.includes(reason)) return null;
    return { verb, orderId, expected, reason };
  }
  return m[4] === undefined ? { verb, orderId, expected } : null;
}

/** The reasons staff may cancel with from `status` (TZ §6; «Не забрал в BTS» only after handover). */
export function staffCancelReasons(status: OrderStatus): CancelReason[] {
  return CANCEL_REASONS_BY_ACTOR.staff.filter((r) => {
    const only = CANCEL_REASON_ONLY_FROM[r];
    return !only || only === status;
  });
}

/** One line of the order's history, with the name of whoever made the move. */
export interface CardEvent {
  action: OrderAction;
  at: Date;
  actorType: 'customer' | 'staff' | 'ai' | 'system';
  /** The staff member's name; null when their row is gone. */
  staffName: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
}

export interface CardData {
  order: OrderRow;
  lines: readonly OrderLineRow[];
  customer: {
    telegramId: number;
    firstName: string;
    lastName: string | null;
    username: string | null;
    phone: string | null;
  };
  events: readonly CardEvent[];
  panel: OrderCardPanel;
}

type InlineButton = { text: string; callback_data: string };
export interface CardView {
  text: string;
  /** Null when the order has no step left (delivered, returned, cancelled). */
  keyboard: InlineButton[][] | null;
}

const EVENT_ICON: Record<OrderAction, string> = {
  submit_receipt: '🧾',
  confirm_payment: '💳',
  reject_receipt: '⛔',
  payment_not_found: '⚠️',
  accept: '✅',
  start_assembly: '📦',
  hand_to_bts: '🚚',
  deliver: '🏁',
  return: '↩️',
  cancel: '❌',
};

/** Escape text for Telegram's HTML parse mode. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The length Telegram counts: the text after its HTML is parsed. */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/&(lt|gt|quot|amp);/g, '_').length;
}

const clip = (s: string, max: number | null) =>
  max === null || [...s].length <= max ? s : `${[...s].slice(0, max).join('')}…`;

/** How hard a card is squeezed to fit Telegram's 4096: more lines and history folded each step. */
const SQUEEZE = [
  { lines: null, history: null, text: null },
  { lines: 20, history: 12, text: 300 },
  { lines: 8, history: 6, text: 120 },
  { lines: 3, history: 3, text: 60 },
] as const;

/**
 * The order's card as staff read it in «Заказы» (spec Changes 2026-11-07): the number and status,
 * the lines, discount and total, the BTS point, the recipient, a link to the customer, the
 * comment, the gift mark and greeting, the tracking number and the history («✅ Принят —
 * Дилноза, 14:32», Tashkent time). Everything typed by people is escaped. Under it, the next step
 * and «Отменить», or the cancel reasons, or one reason to confirm.
 */
export function renderCard(d: CardData, language: Language = 'ru'): CardView {
  const keyboard = cardKeyboard(d, language);
  // the tightest squeeze is bounded well under the limit (three lines, three history lines,
  // typed texts at 60 characters), so it is the answer when nothing looser fits
  let text = '';
  for (const squeeze of SQUEEZE) {
    text = cardText(d, language, squeeze);
    if (visibleLength(text) <= MESSAGE_MAX) break;
  }
  return { text, keyboard };
}

function cardText(
  d: CardData,
  language: Language,
  squeeze: { lines: number | null; history: number | null; text: number | null },
): string {
  const dict = dictionaries[language];
  const g = dict.bot.group;
  const admin = dict.admin.orders;
  const o = d.order;
  const money = (n: number) => formatMoney(n, language);
  const out: string[] = [];

  out.push(
    `<b>${fill(g.title, { number: String(o.number) })}</b> · ${dict.orders.status[o.status]}`,
    '',
  );

  const sorted = [...d.lines].sort((a, b) => a.position - b.position);
  const shown = squeeze.lines === null ? sorted : sorted.slice(0, squeeze.lines);
  for (const l of shown) {
    const name = escapeHtml(language === 'uz' ? l.nameUz : l.nameRu);
    const what = l.kind === 'volume' ? `${name}, ${l.ml} ${unitMl(language)}` : name;
    out.push(`• ${what} × ${l.qty} — ${money(l.lineTotal)}`);
    if (l.setComposition)
      out.push(`   ${escapeHtml(l.setComposition.map((f) => f.name).join(', '))}`);
  }
  if (shown.length < sorted.length)
    out.push(fill(g.moreLines, { n: String(sorted.length - shown.length) }));
  if (o.discount) {
    const source = fill(admin.detail.discountSource[o.discount.type], {
      code: o.discount.type === 'promo_code' ? escapeHtml(o.discount.code) : '',
    });
    out.push(`${fill(g.discount, { source })}: −${money(o.discountAmount)}`);
  }
  out.push(`${g.delivery}: ${o.deliveryFee === 0 ? g.free : money(o.deliveryFee)}`);
  out.push(`<b>${g.total}: ${money(o.total)}</b>`, '');

  if (o.typedAddress === null) {
    const where = [o.pointName, o.pointCity, language === 'uz' ? o.regionNameUz : o.regionNameRu]
      .filter((p): p is string => !!p)
      .map(escapeHtml)
      .join(', ');
    out.push(`📍 ${g.point} ${escapeHtml(o.pointCode ?? '')}: ${where}`);
    out.push(escapeHtml(o.pointAddress ?? ''));
    if (o.pointLandmark) out.push(`${g.landmark}: ${escapeHtml(o.pointLandmark)}`);
  } else {
    const region = language === 'uz' ? o.regionNameUz : o.regionNameRu;
    out.push(
      `📍 ${g.typed} (${escapeHtml(region)}): ${escapeHtml(clip(o.typedAddress, squeeze.text))}`,
    );
    out.push(g.typedNote);
  }
  out.push(`👤 ${g.recipient}: ${escapeHtml(o.recipientName)}, ${formatPhone(o.recipientPhone)}`);
  const c = d.customer;
  const fullName = escapeHtml(c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName);
  out.push(
    `🙋 ${g.customer}: ` +
      [
        `<a href="tg://user?id=${c.telegramId}">${fullName}</a>`,
        ...(c.username ? [`@${escapeHtml(c.username)}`] : []),
        ...(c.phone ? [formatPhone(c.phone)] : []),
      ].join(' · '),
  );
  if (o.comment) out.push(`💬 ${g.comment}: ${escapeHtml(clip(o.comment, squeeze.text))}`);
  if (o.isGift) {
    out.push(`🎁 ${g.gift}`);
    out.push(
      o.giftMessage
        ? fill(g.greeting, { text: escapeHtml(clip(o.giftMessage, squeeze.text)) })
        : g.noGreeting,
    );
  }
  if (o.trackingNumber) out.push(`🚚 ${g.tracking}: <code>${escapeHtml(o.trackingNumber)}</code>`);
  // paid once a payment was confirmed, whatever came after (#33's payment state): a Refund is owed
  if (o.status === 'cancelled' && d.events.some((e) => e.action === 'confirm_payment'))
    out.push(`💸 ${g.refundDue}`);

  out.push('', `<b>${g.history}</b>`);
  const history = historyLines(d, language);
  const kept = squeeze.history === null ? history : history.slice(-squeeze.history);
  if (kept.length < history.length)
    out.push(fill(g.moreHistory, { n: String(history.length - kept.length) }));
  out.push(...kept);

  if (isStepStatus(o.status) && d.panel.kind === 'cancel') out.push('', g.cancelAsk);
  if (isStepStatus(o.status) && d.panel.kind === 'confirm_cancel')
    out.push('', fill(g.cancelConfirm, { reason: admin.cancelReasons[d.panel.reason] }));
  return out.join('\n');
}

const unitMl = (language: Language) => (language === 'uz' ? 'ml' : 'мл');

/**
 * «✅ Принят — Дилноза, 14:32»: the first line and every line on a new Tashkent day carry the
 * date too («9 ноября, 15:00»), so a card read days later still says when.
 */
function historyLines(d: CardData, language: Language): string[] {
  const dict = dictionaries[language];
  const g = dict.bot.group;
  const admin = dict.admin.orders;
  let lastDay: string | null = null;
  const when = (at: Date) => {
    const day = formatDayMonth(at, language);
    const text = day === lastDay ? formatTime(at) : `${day}, ${formatTime(at)}`;
    lastDay = day;
    return text;
  };
  const lines = [`🛒 ${g.placed}, ${when(d.order.createdAt)}`];
  for (const e of d.events) {
    const who =
      e.actorType === 'staff'
        ? escapeHtml(e.staffName ?? admin.detail.actor.removed)
        : admin.detail.actor[e.actorType];
    let line = `${EVENT_ICON[e.action]} ${admin.detail.event[e.action]} — ${who}, ${when(e.at)}`;
    const detail = eventDetail(e, language);
    if (detail) line += `: ${detail}`;
    lines.push(line);
  }
  return lines;
}

function eventDetail(e: CardEvent, language: Language): string | null {
  const admin = dictionaries[language].admin.orders;
  if (e.action === 'cancel' && e.reason && e.reason in admin.cancelReasons)
    return admin.cancelReasons[e.reason as CancelReason];
  if (e.action === 'reject_receipt' && e.reason && e.reason in admin.rejectReasons)
    return admin.rejectReasons[e.reason as keyof typeof admin.rejectReasons];
  if (e.action === 'hand_to_bts' && typeof e.payload.trackingNumber === 'string')
    return escapeHtml(e.payload.trackingNumber);
  return null;
}

function cardKeyboard(d: CardData, language: Language): InlineButton[][] | null {
  const status = d.order.status;
  if (!isStepStatus(status)) return null;
  const g = dictionaries[language].bot.group;
  const reasons = dictionaries[language].admin.orders.cancelReasons;
  const orderId = d.order.id;
  const button = (text: string, p: CardPress) => ({ text, callback_data: encodePress(p) });
  const back = button(g.back, { verb: 'back', orderId, expected: status });
  switch (d.panel.kind) {
    case 'cancel':
      return [
        ...staffCancelReasons(status).map((reason) => [
          button(reasons[reason], { verb: 'reason', orderId, expected: status, reason }),
        ]),
        [back],
      ];
    case 'confirm_cancel': {
      const reason = d.panel.reason;
      return [
        [
          button(fill(g.confirmCancel, { reason: reasons[reason] }), {
            verb: 'confirm',
            orderId,
            expected: status,
            reason,
          }),
        ],
        [back],
      ];
    }
    case 'steps':
      return [
        [button(g.step[NEXT_STEP[status]], { verb: 'next', orderId, expected: status })],
        [button(g.cancel, { verb: 'cancel', orderId, expected: status })],
      ];
  }
}
