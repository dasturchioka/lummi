import {
  CANCEL_REASONS,
  RECEIPT_REJECT_REASONS,
  WAITING_RECEIPT_VERDICTS,
  type AdminOrderDto,
  type AdminOrderEventDto,
  type AdminReceiptDto,
  type CancelReason,
  type ReceiptRejectReason,
} from '@lummi/contracts';
import {
  formatCalendarDate,
  formatDecimal,
  formatMoney,
  formatPhone,
  formatTiyin,
  type Language,
} from '@lummi/i18n';
import { ChevronRight, ExternalLink, FileText, Gift } from 'lucide-react';
import Link from 'next/link';
import { actionLabel, Details, who } from '@/components/audit-view';
import { Button } from '@/components/ui/button';
import { MetaLine } from '@/components/ui/meta-line';
import { Section } from '@/components/ui/section';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent } from '@/lib/setting-copy';
import { QUIET_ACTION, TEXT_LINK } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';
import { VerdictBadge } from './badges';
import { Mark, mismatchMarks } from './order-dialogs';

type Props = { page: AdminOrderDto; t: AdminMessages; language: Language };

/** The private staff endpoint (ADR 0020): never a public URL; the admin proxies `/api` to the API. */
const receiptFile = (id: number, variant: 'original' | 'normalized') =>
  `/api/admin/receipts/${id}/file?variant=${variant}`;

const minus = (amount: number, language: Language) => `−${formatMoney(amount, language)}`;

/** A size in KB or MB in the panel's words and the language's notation («74 КБ», «1,2 МБ»). */
function fileSize(bytes: number, t: AdminMessages, language: Language) {
  const d = t.orders.detail;
  const text =
    bytes >= 1_000_000
      ? fill(d.sizeMb, { n: formatDecimal(bytes / 1_000_000, 1, language) })
      : fill(d.sizeKb, { n: formatDecimal(Math.max(1, Math.round(bytes / 1000)), 0, language) });
  return text.replace(' ', '\u00a0');
}

/** A label: value row of a side card (Muted Ink label above, the value under it). */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[12.5px] font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * Every receipt, newest first: the image the AI saw (the original opens in a new tab), the
 * verdict, when and how it came, and for a rejected one who turned it down, why and in what
 * words. The receipt under check carries «Отклонить чек» while the order is «Чек на проверке».
 */
export function ReceiptsSection({
  page,
  t,
  language,
  onReject,
  onConfirm,
}: Props & {
  onReject: (r: AdminReceiptDto) => void;
  onConfirm: (r: AdminReceiptDto) => void;
}) {
  const d = t.orders.detail;
  const open = page.order.status === 'receipt_review';
  const due = formatMoney(page.order.amountDue, language);
  return (
    <Section title={d.receipts}>
      {page.receipts.length === 0 ? (
        <p className="-mt-2 text-sm text-muted-foreground">{d.noReceipts}</p>
      ) : (
        <ul className="-mt-1 grid gap-6" data-receipts>
          {page.receipts.map((r) => {
            const waiting = open && WAITING_RECEIPT_VERDICTS.includes(r.verdict);
            const at = formatTashkent(r.createdAt);
            // a tap opens the whole image: the original for a screenshot, the rendered page for a PDF
            const full = receiptFile(r.id, r.kind === 'pdf' ? 'normalized' : 'original');
            return (
              <li
                key={r.id}
                className="grid grid-cols-[136px_minmax(0,1fr)] gap-4 sm:grid-cols-[200px_minmax(0,1fr)]"
                data-receipt={r.id}
              >
                <a
                  href={full}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative block self-start overflow-hidden rounded-[8px] bg-field"
                  aria-label={d.openOriginal}
                >
                  <img
                    src={receiptFile(r.id, 'normalized')}
                    alt={fill(d.receiptAlt, { at })}
                    width={r.width}
                    height={r.height}
                    decoding="async"
                    className="block h-auto max-h-[26rem] w-full object-contain object-top transition-opacity duration-150 group-hover:opacity-90"
                  />
                  {r.kind === 'pdf' && (
                    <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-card/92 px-2 py-0.5 text-[11px] font-semibold">
                      <FileText className="size-3" strokeWidth={1.75} aria-hidden />
                      {d.pdf}
                    </span>
                  )}
                </a>
                <div className="grid min-w-0 content-start gap-2">
                  <div>
                    <VerdictBadge verdict={r.verdict} t={t} />
                  </div>
                  {/* what the receipt must show, right beside it */}
                  <p className="text-[15px] leading-snug tabular-nums" data-due>
                    <span className="text-muted-foreground">{d.amountDue}: </span>
                    <span className="font-semibold whitespace-nowrap">{due}</span>
                  </p>
                  <MetaLine
                    className="text-small text-muted-foreground"
                    parts={[
                      <time
                        key="at"
                        dateTime={r.createdAt}
                        className="whitespace-nowrap tabular-nums"
                      >
                        {at}
                      </time>,
                      d.source[r.source],
                      r.fileName && (
                        <span key="name" className="[overflow-wrap:anywhere]">
                          {r.fileName}
                        </span>
                      ),
                      <span key="size" className="whitespace-nowrap">
                        {fileSize(r.size, t, language)}
                      </span>,
                    ]}
                  />
                  {r.reviewReason && WAITING_RECEIPT_VERDICTS.includes(r.verdict) && (
                    <Mark>{d.reviewReason[r.reviewReason]}</Mark>
                  )}
                  {r.confirmation && (
                    <p className="text-small text-muted-foreground">
                      {r.confirmation.by.type === 'ai'
                        ? fill(d.confirmedByAi, { at: formatTashkent(r.confirmation.at) })
                        : fill(d.confirmedBy, {
                            name: r.confirmation.by.name ?? d.actor.removed,
                            at: formatTashkent(r.confirmation.at),
                          })}
                    </p>
                  )}
                  {r.rejection && (
                    <div className="grid gap-1 border-l-2 border-border pl-3 text-[13.5px] leading-snug">
                      <p className="font-medium">{rejectLabel(t, r.rejection.reason)}</p>
                      {r.rejection.note && (
                        <p className="text-pretty [overflow-wrap:anywhere]">{r.rejection.note}</p>
                      )}
                      <p className="text-small text-muted-foreground">
                        {fill(d.rejectedBy, {
                          name: r.rejection.by.name ?? d.actor.removed,
                          at: formatTashkent(r.rejection.at),
                        })}
                      </p>
                    </div>
                  )}
                  {waiting && (
                    // the routine press first; turning the receipt down sits on its own row below
                    <div className="grid justify-items-start gap-2 pt-0.5">
                      <Button size="sm" onClick={() => onConfirm(r)} data-confirm-receipt={r.id}>
                        {d.confirm}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={cn('-ml-3', QUIET_ACTION)}
                        onClick={() => onReject(r)}
                      >
                        {d.reject}
                      </Button>
                    </div>
                  )}
                  <a
                    href={receiptFile(r.id, 'original')}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(TEXT_LINK, 'inline-flex w-fit items-center gap-1 text-[13px]')}
                  >
                    {r.kind === 'pdf' ? d.downloadOriginal : d.openOriginal}
                    <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden />
                  </a>
                  {r.checks.length > 0 && <Checks checks={r.checks} t={t} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * The receipt AI answers yes/no questions as probabilities (ADR 0013); it never reads an amount
 * off the image. Shown in words: the answer, and how firmly («да, уверенно»). Display only: the
 * judge's own `confirmed`, not these words, is what ever paid anything.
 */
function answerWords(p: number, ai: AdminMessages['orders']['ai']) {
  const firm = Math.abs(p - 0.5) * 2;
  return `${p >= 0.5 ? ai.yes : ai.no}, ${firm >= 0.8 ? ai.sure : firm >= 0.4 ? ai.likely : ai.unsure}`;
}
/** The choice among the candidate credits' times: found one or none, and how concentrated. */
function choiceWords(c: AdminReceiptDto['checks'][number], ai: AdminMessages['orders']['ai']) {
  const firm = c.choiceConfidence;
  const how = firm >= 0.8 ? ai.sure : firm >= 0.5 ? ai.likely : ai.unsure;
  return `${c.chosenCreditId !== null ? ai.yes : ai.no}, ${how}`;
}

/**
 * The receipt AI's answers about one receipt (#32), newest first, in plain words: when it looked,
 * how many credits it compared with, its four answers and what came of it. No provider names,
 * no raw strings: those stay in the database for tuning.
 */
function Checks({ checks, t }: { checks: AdminReceiptDto['checks']; t: AdminMessages }) {
  const d = t.orders.detail;
  const ai = t.orders.ai;
  return (
    <details className="group mt-1 text-[13px]" open={checks.length === 1} data-checks>
      <summary
        className={cn(
          'inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-sm select-none [&::-webkit-details-marker]:hidden',
          QUIET_ACTION,
        )}
      >
        <ChevronRight
          className="size-3.5 transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
          strokeWidth={1.75}
          aria-hidden
        />
        {d.checks} · {checks.length}
      </summary>
      <ul className="mt-1 grid gap-2.5">
        {checks.map((c) => (
          <li key={c.id} className="grid gap-1 rounded-button bg-field px-3 py-2.5">
            <MetaLine
              className="text-small text-muted-foreground tabular-nums"
              parts={[
                fill(ai.title, { at: formatTashkent(c.at) }),
                fill(ai.compared, { n: String(c.candidates) }),
              ]}
            />
            {c.provider === 'none' ? (
              <p>{ai.noAnswer}</p>
            ) : (
              <dl className="grid gap-0.5">
                {(
                  [
                    [ai.isReceipt, answerWords(c.isReceipt, ai)],
                    [ai.amountMatches, answerWords(c.amountMatches, ai)],
                    [ai.recipientMatches, answerWords(c.recipientMatches, ai)],
                    [ai.choice, choiceWords(c, ai)],
                  ] as const
                ).map(([q, a]) => (
                  <div key={q} className="flex flex-wrap gap-x-1.5">
                    <dt className="text-muted-foreground">{q}:</dt>
                    <dd className="font-medium">{a}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="font-medium">{d.checkOutcome[c.outcome ?? 'waiting']}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

const rejectLabel = (t: AdminMessages, reason: string) =>
  RECEIPT_REJECT_REASONS.includes(reason as ReceiptRejectReason)
    ? t.orders.rejectReasons[reason as ReceiptRejectReason]
    : reason;

/**
 * The lines as bought (the snapshot) and the totals, every amount from the server. A returned
 * order says of each line whether it went back on hand (#40).
 */
export function LinesSection({ page, t, language }: Props) {
  const d = t.orders.detail;
  const o = page.order;
  const discount = o.discount;
  const flags = page.returned?.lines;
  return (
    <Section title={d.lines}>
      <ul className="-mt-1 divide-y divide-border">
        {o.lines.map((l, i) => (
          <li key={i} className="flex gap-4 py-3 first:pt-0">
            <div className="min-w-0 flex-1">
              {l.promoGift && <p className="text-small font-medium text-sage-ink">{d.promoGift}</p>}
              <p className="font-medium break-words">{l.name[language]}</p>
              <MetaLine
                className="text-small text-muted-foreground"
                parts={[
                  l.brand && fill(d.inspired, { brand: l.brand }),
                  l.kind === 'volume' && fill(d.qty, { ml: String(l.ml), qty: String(l.qty) }),
                  l.kind !== 'volume' && d.setOf,
                  l.kind !== 'volume' && fill(d.units, { qty: String(l.qty) }),
                ]}
              />
              {l.setComposition && (
                <ol className="mt-1.5 grid gap-0.5 text-small text-muted-foreground">
                  {l.setComposition.map((f, j) => (
                    <li key={j} className="break-words">
                      {f.name}
                    </li>
                  ))}
                </ol>
              )}
              {flags?.[i] && (
                <p
                  className={cn(
                    'mt-1.5 text-small font-medium',
                    flags[i].backToStock ? 'text-sage-ink' : 'text-muted-foreground',
                  )}
                  data-back-to-stock={flags[i].backToStock}
                >
                  {flags[i].backToStock ? t.orders.ret.toStockMark : t.orders.ret.offStockMark}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right tabular-nums">
              <p className="font-semibold whitespace-nowrap">
                {formatMoney(l.lineTotal, language)}
              </p>
              {/* a gift code's gift is free; its regular price, struck, is what reports count */}
              {(l.markedDown || l.promoGift) && (
                <s className="block text-small whitespace-nowrap text-muted-foreground">
                  {formatMoney(l.regularUnitPrice, language)}
                </s>
              )}
            </div>
          </li>
        ))}
      </ul>
      <dl className="grid gap-1.5 border-t border-border pt-4 text-sm tabular-nums">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{d.items}</dt>
          <dd className="whitespace-nowrap">{formatMoney(o.itemsSubtotal, language)}</dd>
        </div>
        {/* a gift code takes nothing off: its free line above says what it gave (ADR 0039) */}
        {discount && !(discount.type === 'promo_code' && discount.gift) && (
          <div className="flex justify-between gap-4">
            <dt className="min-w-0 text-muted-foreground">
              {d.discount}
              <span className="block text-small [overflow-wrap:anywhere]">
                {discount.type === 'promo_code'
                  ? fill(d.discountSource.promo_code, { code: discount.code })
                  : d.discountSource[discount.type]}
              </span>
            </dt>
            <dd className="whitespace-nowrap text-sage-ink">{minus(discount.amount, language)}</dd>
          </div>
        )}
        {discount?.type === 'promo_code' && discount.gift && (
          <div className="flex justify-between gap-4">
            <dt className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
              {fill(d.promoGiftSource, { code: discount.code })}
            </dt>
            <dd className="whitespace-nowrap text-sage-ink">{formatMoney(0, language)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{d.deliveryFee}</dt>
          <dd className="whitespace-nowrap">
            {o.deliveryFee === 0 ? d.free : formatMoney(o.deliveryFee, language)}
          </dd>
        </div>
        <div className="mt-1 flex justify-between gap-4 border-t border-border pt-2.5 text-[15px] font-semibold">
          <dt>{d.total}</dt>
          <dd className="whitespace-nowrap">{formatMoney(o.total, language)}</dd>
        </div>
      </dl>
    </Section>
  );
}

/** Who ordered: a link to their customer page (#27), the account phone, Telegram, the language. */
export function CustomerSection({ page, t }: Props) {
  const d = t.orders.detail;
  const c = page.customer;
  return (
    <Section title={d.customer}>
      <div className="-mt-1 grid gap-1 text-sm">
        <Link
          href={`/customers/${c.id}`}
          className="font-semibold break-words underline-offset-[3px] hover:underline"
          title={d.openCustomer}
        >
          {c.name}
        </Link>
        {c.phone ? (
          <a href={`tel:${c.phone}`} className="w-fit whitespace-nowrap tabular-nums">
            {formatPhone(c.phone)}
          </a>
        ) : (
          <span className="text-muted-foreground">{d.noPhone}</span>
        )}
        {c.username && (
          <a
            href={`https://t.me/${c.username}`}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-muted-foreground [overflow-wrap:anywhere] hover:text-foreground"
          >
            @{c.username}
          </a>
        )}
        <span className="text-small text-muted-foreground">{d.language[c.language]}</span>
      </div>
    </Section>
  );
}

/** Who collects it and where: the Recipient, the BTS point as frozen (or the typed address), the tracking number. */
export function DeliverySection({ page, t, language }: Props) {
  const d = t.orders.detail;
  const o = page.order;
  const point = o.delivery.point;
  return (
    <Section title={d.shipping}>
      <dl className="-mt-1 grid gap-3 text-sm">
        <Fact label={d.recipient}>
          <span className="block font-medium">{o.recipient.name}</span>
          <a href={`tel:${o.recipient.phone}`} className="whitespace-nowrap tabular-nums">
            {formatPhone(o.recipient.phone)}
          </a>
        </Fact>
        <Fact label={o.delivery.region[language]}>
          {point ? (
            <>
              <span className="block font-medium">{point.name}</span>
              <span className="block">
                {point.city}, {point.address}
              </span>
              <MetaLine
                className="text-small text-muted-foreground"
                parts={[point.code, point.landmark, point.hours]}
              />
            </>
          ) : (
            <>
              <span className="block font-medium">{d.typed}</span>
              <span className="block [overflow-wrap:anywhere]">{o.delivery.typed}</span>
              <span className="mt-1 block text-small text-pretty text-muted-foreground">
                {d.typedNote}
              </span>
            </>
          )}
        </Fact>
        {page.trackingNumber && (
          <Fact label={d.tracking}>
            <span className="font-medium tracking-[0.04em] [overflow-wrap:anywhere] tabular-nums">
              {page.trackingNumber}
            </span>
          </Fact>
        )}
      </dl>
    </Section>
  );
}

/** What is owed, until when the stock is held, and the credit that paid it («Не привязано» until one does). */
export function PaymentSection({ page, t, language }: Props) {
  const d = t.orders.detail;
  const o = page.order;
  const holding = o.status === 'awaiting_payment' || o.status === 'receipt_review';
  return (
    <Section title={d.payment}>
      <dl className="-mt-1 grid gap-3 text-sm">
        <Fact label={d.amountDue}>
          <span className="text-[20px] leading-tight font-semibold whitespace-nowrap tabular-nums">
            {formatMoney(o.amountDue, language)}
          </span>
          {holding && (
            <span className="mt-0.5 block text-small text-muted-foreground tabular-nums">
              {fill(d.reserveUntil, { at: formatTashkent(o.reserveUntil) })}
            </span>
          )}
        </Fact>
        <Fact label={d.credit}>
          {page.credit ? (
            <MatchedCredit credit={page.credit} t={t} language={language} />
          ) : (
            <span className="text-muted-foreground">{d.noCredit}</span>
          )}
        </Fact>
        {page.refunds.length > 0 && <Refunds page={page} t={t} language={language} />}
      </dl>
    </Section>
  );
}

/**
 * The order's Refunds (ADR 0006, #40), oldest first: what went back of what paid it, then each
 * transfer with its day, its reason, and who recorded it when.
 */
function Refunds({ page, t, language }: Props) {
  const r = t.orders.refund;
  const money = (n: number) => formatMoney(n, language);
  return (
    <Fact label={r.section}>
      <span className="block font-medium tabular-nums">
        {fill(r.total, { refunded: money(page.money.refunded), paid: money(page.money.paid ?? 0) })}
      </span>
      <ul className="mt-2 grid gap-3" data-refunds>
        {page.refunds.map((x) => (
          <li key={x.id} className="grid gap-0.5">
            <span className="font-medium whitespace-nowrap tabular-nums">
              {fill(r.line, {
                amount: money(x.amount),
                date: formatCalendarDate(x.date, language),
              })}
            </span>
            <span className="text-small text-pretty [overflow-wrap:anywhere]">{x.reason}</span>
            <span className="text-small text-muted-foreground tabular-nums">
              {fill(r.by, {
                name: x.by.name ?? t.orders.detail.actor.removed,
                at: formatTashkent(x.at),
              })}
            </span>
          </li>
        ))}
      </ul>
    </Fact>
  );
}

/**
 * The Credit that paid the order: its exact amount, when and to which card it came, how it
 * differs from the Amount due, the reason staff gave for that, and who linked it.
 */
function MatchedCredit({
  credit,
  t,
  language,
}: {
  credit: NonNullable<AdminOrderDto['credit']>;
  t: AdminMessages;
  language: Language;
}) {
  const d = t.orders.detail;
  const marks = mismatchMarks(
    {
      differenceTiyin: credit.link.differenceTiyin,
      onShopCard: !credit.link.offShopCard,
      cardLast4: credit.cardLast4,
    },
    t,
    language,
  );
  const at = formatTashkent(credit.link.at);
  return (
    <span className="grid gap-0.5" data-matched-credit>
      <span className="font-medium whitespace-nowrap tabular-nums">
        {formatTiyin(credit.amountTiyin, language)}
      </span>
      <MetaLine
        className="text-small text-muted-foreground tabular-nums"
        parts={[
          formatTashkent(credit.occurredAt),
          <span key="card" className="whitespace-nowrap">
            {credit.cardMask}
          </span>,
          credit.counterparty && (
            <span key="from" className="[overflow-wrap:anywhere]">
              {credit.counterparty}
            </span>
          ),
        ]}
      />
      {marks.map((m) => (
        <Mark key={m}>{m}</Mark>
      ))}
      {credit.link.reason && (
        <span className="text-small text-pretty [overflow-wrap:anywhere]">
          {fill(d.linkReason, { reason: credit.link.reason })}
        </span>
      )}
      <span className="text-small text-muted-foreground">
        {credit.link.by.type === 'ai'
          ? fill(d.linkedByAi, { at })
          : fill(d.linkedBy, { name: credit.link.by.name ?? d.actor.removed, at })}
      </span>
    </span>
  );
}

/** The shopper's comment, as written; nothing when they left none. */
export function CommentSection({ page, t }: Props) {
  const comment = page.order.comment;
  if (!comment) return null;
  return (
    <Section title={t.orders.detail.comment}>
      <p className="-mt-1 text-sm whitespace-pre-line text-pretty [overflow-wrap:anywhere]">
        {comment}
      </p>
    </Section>
  );
}

/** «Это подарок»: gift-packed, no receipt in the parcel, and the greeting card text if any. */
export function GiftSection({ page, t }: Props) {
  const d = t.orders.detail;
  const gift = page.order.gift;
  if (!gift.isGift) return null;
  return (
    <Section title={d.gift} action={<Gift className="size-[18px]" strokeWidth={1.5} aria-hidden />}>
      <dl className="-mt-1 grid gap-3 text-sm">
        <Fact label={d.greeting}>
          <span className="whitespace-pre-line text-pretty [overflow-wrap:anywhere]">
            {gift.message ?? d.noGreeting}
          </span>
        </Fact>
      </dl>
    </Section>
  );
}

/** Who moved the order, from the order itself to its last step, oldest first. */
export function HistorySection({ page, t }: Props) {
  const d = t.orders.detail;
  const actor = (e: AdminOrderEventDto) =>
    e.actor.type === 'staff' || e.actor.type === 'customer'
      ? (e.actor.name ?? (e.actor.type === 'staff' ? d.actor.removed : d.actor.customer))
      : d.actor[e.actor.type];
  const reason = (e: AdminOrderEventDto) => {
    if (!e.reason) return null;
    if (e.action === 'cancel' && CANCEL_REASONS.includes(e.reason as CancelReason))
      return t.orders.cancelReasons[e.reason as CancelReason];
    if (e.action === 'reject_receipt') return rejectLabel(t, e.reason);
    return e.reason;
  };
  const rows = [
    {
      id: 0,
      at: page.order.createdAt,
      label: d.placed,
      who: page.customer.name,
      extra: [] as string[],
    },
    ...page.events.map((e) => ({
      id: e.id,
      at: e.at,
      label: d.event[e.action],
      who: actor(e),
      extra: [
        reason(e),
        e.note && fill(d.noteLine, { note: e.note }),
        e.trackingNumber && fill(d.trackingLine, { tracking: e.trackingNumber }),
      ].filter((x): x is string => Boolean(x)),
    })),
  ];
  return (
    <Section title={d.history}>
      <ol className="-mt-1 grid">
        {rows.map((r, i) => (
          <li
            key={r.id}
            className="relative grid grid-cols-[14px_minmax(0,1fr)] gap-3 pb-4 last:pb-0"
          >
            {/* the Sage thread between the dots (DESIGN.md), stopping at the last one */}
            {i < rows.length - 1 && (
              <span
                aria-hidden
                className="absolute top-3 bottom-0 left-[6px] w-0.5 rounded bg-sage/60"
              />
            )}
            <span
              aria-hidden
              className={cn(
                'mt-1.5 size-3.5 rounded-full border-2 border-card',
                i === rows.length - 1 ? 'bg-graphite' : 'bg-sage',
              )}
            />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{r.label}</p>
              <MetaLine
                className="text-small text-muted-foreground"
                parts={[
                  <time key="at" dateTime={r.at} className="whitespace-nowrap tabular-nums">
                    {formatTashkent(r.at)}
                  </time>,
                  r.who,
                ]}
              />
              {r.extra.map((x, j) => (
                <p key={j} className="mt-0.5 text-[13px] text-pretty [overflow-wrap:anywhere]">
                  {x}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** The audit entries about this order, newest first, each with its raw details behind «Подробнее». */
export function AuditSection({ page, t, language }: Props) {
  const d = t.orders.detail;
  return (
    <Section title={d.audit}>
      {page.audit.length === 0 ? (
        <p className="-mt-2 text-sm text-muted-foreground">{d.noAudit}</p>
      ) : (
        <ul className="-mt-1 divide-y divide-border">
          {page.audit.map((e) => (
            <li key={e.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
                  {actionLabel(t, e.action)}
                </span>
                <time
                  dateTime={e.createdAt}
                  className="shrink-0 text-small text-muted-foreground tabular-nums"
                >
                  {formatTashkent(e.createdAt)}
                </time>
              </div>
              <p className="text-small text-muted-foreground">{who(t, e)}</p>
              <div className="text-[13px]">
                <Details t={t} language={language} e={e} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
