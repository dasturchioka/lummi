import {
  RECEIPT_REJECT_REASONS,
  WAITING_RECEIPT_VERDICTS,
  type OrderStatus,
  type ReceiptRejectReason,
  type ReceiptReviewReason,
  type ReceiptVerdict,
} from '@lummi/contracts';
import type { ManualReviewPanel } from '@lummi/db';
import {
  fill,
  formatDayMonth,
  formatMoney,
  formatTiyin,
  formatTime,
  type Language,
} from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import {
  customerLine,
  escapeHtml,
  eventLine,
  type CardData,
  type CardEvent,
  type CardView,
} from './card-view';

/** The namespace of a manual-review post's buttons (`ord:` is the card's, `rcpt:` #31's, `rev:` #41's). */
export const MANUAL_REVIEW_CALLBACK = /^mr:/;

/** How many Candidate credits a post lists, each with its own «Оплата подтверждена». */
export const CANDIDATES_SHOWN = 5;

/**
 * The reasons the group offers for «Чек не принят»: the admin dialog's presets (#33) but «Другая
 * причина», which needs the manager's own words and so stays in the admin.
 */
export const GROUP_REJECT_REASONS: readonly ReceiptRejectReason[] = RECEIPT_REJECT_REASONS.filter(
  (r) => r !== 'other',
);

/**
 * A button on a manual-review post; its data names the receipt (the hold). `pick`: show one credit
 * to confirm with; `confirm`: confirm with it; `reject`: show the reasons; `reason`: ask to confirm
 * that reason; `confirm_reject`: reject with it; `back`: the choices again.
 */
export type ManualReviewPress =
  | { verb: 'pick' | 'confirm'; receiptId: number; creditId: number }
  | { verb: 'reject' | 'back'; receiptId: number }
  | { verb: 'reason' | 'confirm_reject'; receiptId: number; reason: ReceiptRejectReason };

const CODES = {
  pick: 'c',
  confirm: 'y',
  reject: 'x',
  back: 'b',
  reason: 'r',
  confirm_reject: 'n',
} as const satisfies Record<ManualReviewPress['verb'], string>;
const VERBS = Object.fromEntries(Object.entries(CODES).map(([v, c]) => [c, v])) as Record<
  string,
  ManualReviewPress['verb']
>;

/** `mr:<verb>:<receipt id>[:<credit id or reason>]`, at most 37 bytes. */
export function encodeManualReviewPress(p: ManualReviewPress): string {
  const base = `mr:${CODES[p.verb]}:${p.receiptId}`;
  if ('creditId' in p) return `${base}:${p.creditId}`;
  if ('reason' in p) return `${base}:${p.reason}`;
  return base;
}

/** The press a button's data names, or null for anything else (an old or forged button). */
export function decodeManualReviewPress(data: string): ManualReviewPress | null {
  const m = /^mr:([a-z]):(\d{1,16})(?::([a-z0-9_]{1,32}))?$/.exec(data);
  if (!m) return null;
  const verb = VERBS[m[1]!];
  const receiptId = Number(m[2]);
  const arg = m[3];
  if (!verb || !Number.isSafeInteger(receiptId) || receiptId < 1) return null;
  switch (verb) {
    case 'pick':
    case 'confirm': {
      const creditId = Number(arg);
      if (!arg || !/^\d+$/.test(arg) || !Number.isSafeInteger(creditId) || creditId < 1)
        return null;
      return { verb, receiptId, creditId };
    }
    case 'reason':
    case 'confirm_reject': {
      const reason = arg as ReceiptRejectReason | undefined;
      if (!reason || !GROUP_REJECT_REASONS.includes(reason)) return null;
      return { verb, receiptId, reason };
    }
    case 'reject':
    case 'back':
      return arg === undefined ? { verb, receiptId } : null;
  }
}

/** A Candidate credit as the post lists it. */
export interface ManualReviewCredit {
  id: number;
  amountTiyin: number;
  occurredAt: Date;
  cardMask: string;
  counterparty: string | null;
}

export interface ManualReviewData {
  order: { id: number; number: number; amountDue: number; status: OrderStatus };
  receipt: {
    id: number;
    createdAt: Date;
    verdict: ReceiptVerdict;
    reviewReason: ReceiptReviewReason | null;
  };
  /** How many credits the AI was last shown for this receipt (several: «несколько поступлений»). */
  lastShown: number;
  /**
   * The AI's last answer said the amount on the receipt is not the Amount due (its amount score
   * under the setting `ai.receipt.probabilityThreshold`): «сумма не совпала».
   */
  amountMismatch: boolean;
  /**
   * The credit the AI chose in its last answer, if any; with who marked it «Не для заказа» and
   * when, when staff did (#49: the AI confirmed with it while it was being marked).
   */
  aiChoice: {
    credit: ManualReviewCredit;
    marked: { by: string | null; at: Date } | null;
  } | null;
  customer: CardData['customer'];
  /** The order's Candidate credits now, oldest first (`creditsFor`, the one rule). */
  candidates: readonly ManualReviewCredit[];
  /** The move that ended the review (the order's first move after this receipt), once made. */
  decision: CardEvent | null;
  /** The credit that paid the order, when the decision confirmed the payment. */
  paidWith: ManualReviewCredit | null;
  panel: ManualReviewPanel;
}

/** «9 ноября, 15:01», Tashkent time. */
const when = (at: Date, language: Language) => `${formatDayMonth(at, language)}, ${formatTime(at)}`;

/** «CLICK P2P» of «CLICK P2P U2H ER>TAS»: the first two words of who sent it, for a button. */
export function shortSource(counterparty: string | null): string | null {
  if (!counterparty) return null;
  const words = counterparty.trim().split(/\s+/).slice(0, 2).join(' ');
  return [...words].length > 16 ? `${[...words].slice(0, 15).join('')}…` : words;
}

/**
 * The manual-review post as staff read it in «Заказы» (#51; TZ §4 L292-293, §6 L349-350): the
 * order and Amount due, the reason in the TZ's words, the customer, when the receipt came (it
 * follows as a reply), the Candidate credits, then «Оплата подтверждена» (one per candidate) and
 * «Чек не принят». Decided (the order left «Чек на проверке» or the receipt is no longer
 * waiting), it shows the decision as the card's history does, and no buttons.
 */
export function renderManualReview(d: ManualReviewData, language: Language = 'ru'): CardView {
  const g = dictionaries[language].bot.group;
  const r = g.manualReview;
  const money = (n: number) => formatMoney(n, language);
  const credit = (c: ManualReviewCredit) => [
    formatTiyin(c.amountTiyin, language),
    when(c.occurredAt, language),
    escapeHtml(c.cardMask),
  ];
  /** amount · time · card · source: a credit as the post lists it. */
  const listed = (c: ManualReviewCredit) =>
    [...credit(c), ...(c.counterparty ? [escapeHtml(c.counterparty)] : [])].join(' · ');

  const reason = d.receipt.reviewReason ?? 'not_confirmed';
  const reasonKey =
    reason !== 'not_confirmed'
      ? reason
      : d.amountMismatch
        ? 'amount'
        : d.lastShown > 1
          ? 'several'
          : 'not_confirmed';
  const out = [
    `<b>${fill(r.title, { number: String(d.order.number) })}</b>`,
    fill(r.reason, { reason: r.reasons[reasonKey] }),
    fill(r.due, { amount: money(d.order.amountDue) }),
    `${g.customer}: ${customerLine(d.customer)}`,
    fill(r.receiptAt, { at: when(d.receipt.createdAt, language) }),
  ];

  const open =
    d.order.status === 'receipt_review' && WAITING_RECEIPT_VERDICTS.includes(d.receipt.verdict);
  if (!open) {
    if (d.decision) out.push('', eventLine(d.decision, language, when(d.decision.at, language)));
    if (d.paidWith) out.push(fill(r.paidWith, joined(credit(d.paidWith))));
    return { text: out.join('\n'), keyboard: null };
  }

  const shown = d.candidates.slice(0, CANDIDATES_SHOWN);
  const choice = d.aiChoice;
  out.push('');
  // the AI's credit that staff marked «Не для заказа»: it did arrive, so never «нет поступления»
  if (choice?.marked) {
    out.push(
      fill(r.markedChoice, {
        credit: listed(choice.credit),
        name: escapeHtml(
          choice.marked.by ?? dictionaries[language].admin.orders.detail.actor.removed,
        ),
        at: when(choice.marked.at, language),
      }),
    );
  }
  if (shown.length === 0) {
    out.push(
      choice?.marked
        ? r.noOtherCandidates
        : fill(r.noCandidates, { amount: money(d.order.amountDue) }),
    );
  } else {
    out.push(r.candidates);
    for (const c of shown)
      out.push(`• ${listed(c)}${choice?.credit.id === c.id ? ` ${r.aiChoice}` : ''}`);
    if (d.candidates.length > shown.length)
      out.push(fill(r.moreCandidates, { n: String(d.candidates.length - shown.length) }));
  }

  const receiptId = d.receipt.id;
  const button = (text: string, p: ManualReviewPress) => ({
    text,
    callback_data: encodeManualReviewPress(p),
  });
  const back = [button(g.back, { verb: 'back', receiptId })];
  const reasons = dictionaries[language].admin.orders.rejectReasons;
  const panel = d.panel;
  const picked = panel.kind === 'confirm' ? shown.find((c) => c.id === panel.creditId) : undefined;

  if (picked) {
    const [amount, at, card] = credit(picked);
    const source = picked.counterparty ? [`📍 ${escapeHtml(picked.counterparty)}`] : [];
    out.push('', fill(r.confirmAsk, { credit: [amount, at, ...source, card].join(' · ') }));
    return {
      text: out.join('\n'),
      keyboard: [[button(r.confirmYes, { verb: 'confirm', receiptId, creditId: picked.id })], back],
    };
  }
  if (panel.kind === 'reject') {
    out.push('', r.rejectAsk);
    return {
      text: out.join('\n'),
      keyboard: [
        ...GROUP_REJECT_REASONS.map((reason) => [
          button(reasons[reason], { verb: 'reason', receiptId, reason }),
        ]),
        back,
      ],
    };
  }
  if (panel.kind === 'confirm_reject') {
    const reason = reasons[panel.reason];
    out.push('', fill(r.rejectConfirm, { reason }));
    return {
      text: out.join('\n'),
      keyboard: [
        [
          button(fill(r.rejectYes, { reason }), {
            verb: 'confirm_reject',
            receiptId,
            reason: panel.reason,
          }),
        ],
        back,
      ],
    };
  }

  out.push('', shown.length === 0 ? r.askNoCredit : r.ask);
  // several: each button says what tells its credit apart (amount, time, who sent it); the day
  // too when it is not the receipt's
  const receiptDay = formatDayMonth(d.receipt.createdAt, language);
  const label = (c: ManualReviewCredit) => {
    const day = formatDayMonth(c.occurredAt, language);
    const at = day === receiptDay ? formatTime(c.occurredAt) : when(c.occurredAt, language);
    const source = shortSource(c.counterparty);
    return fill(r.confirmWith, {
      credit: [formatTiyin(c.amountTiyin, language), at, ...(source ? [source] : [])].join(' · '),
    });
  };
  const confirms = shown.map((c) => [
    button(shown.length === 1 ? r.confirm : label(c), {
      verb: 'pick',
      receiptId,
      creditId: c.id,
    }),
  ]);
  return {
    text: out.join('\n'),
    keyboard: [...confirms, [button(r.reject, { verb: 'reject', receiptId })]],
  };
}

function joined([amount, at, card]: string[]) {
  return { amount: amount!, at: at!, card: card! };
}
