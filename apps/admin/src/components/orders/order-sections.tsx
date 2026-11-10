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
import { formatMoney, formatPhone, formatTiyin, type Language } from '@lummi/i18n';
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
import { creditFlags } from './order-dialogs';

type Props = { page: AdminOrderDto; t: AdminMessages; language: Language };

/** The private staff endpoint (ADR 0020): never a public URL; the admin proxies `/api` to the API. */
const receiptFile = (id: number, variant: 'original' | 'normalized') =>
  `/api/admin/receipts/${id}/file?variant=${variant}`;

const minus = (amount: number, language: Language) => `−${formatMoney(amount, language)}`;

/** A size in KB or MB with one decimal, in the panel's words («74 КБ», «1,2 МБ»). */
function fileSize(bytes: number, t: AdminMessages) {
  const d = t.orders.detail;
  return bytes >= 1_000_000
    ? fill(d.sizeMb, { n: (bytes / 1_000_000).toFixed(1).replace('.', ',') }).replace(' ', '\u00a0')
    : fill(d.sizeKb, { n: String(Math.max(1, Math.round(bytes / 1000))) }).replace(' ', '\u00a0');
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
  onReject,
  onConfirm,
}: Omit<Props, 'language'> & {
  onReject: (r: AdminReceiptDto) => void;
  onConfirm: (r: AdminReceiptDto) => void;
}) {
  const d = t.orders.detail;
  const open = page.order.status === 'receipt_review';
  return (
    <Section title={d.receipts}>
      {page.receipts.length === 0 ? (
        <p className="-mt-2 text-sm text-muted-foreground">{d.noReceipts}</p>
      ) : (
        <ul className="-mt-1 grid gap-5" data-receipts>
          {page.receipts.map((r) => {
            const waiting = open && WAITING_RECEIPT_VERDICTS.includes(r.verdict);
            const at = formatTashkent(r.createdAt);
            return (
              <li
                key={r.id}
                className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 sm:grid-cols-[132px_minmax(0,1fr)]"
                data-receipt={r.id}
              >
                <a
                  href={receiptFile(r.id, 'original')}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative block self-start overflow-hidden rounded-[8px] bg-field"
                  aria-label={r.kind === 'pdf' ? d.downloadOriginal : d.openOriginal}
                >
                  <img
                    src={receiptFile(r.id, 'normalized')}
                    alt={fill(d.receiptAlt, { at })}
                    width={r.width}
                    height={r.height}
                    decoding="async"
                    className="block h-auto max-h-64 w-full object-contain object-top transition-opacity duration-150 group-hover:opacity-90"
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
                        {fileSize(r.size, t)}
                      </span>,
                    ]}
                  />
                  {r.reviewReason && WAITING_RECEIPT_VERDICTS.includes(r.verdict) && (
                    <p className="text-[13.5px] leading-snug font-medium text-pretty">
                      {d.reviewReason[r.reviewReason]}
                    </p>
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
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5">
                    {waiting && (
                      <>
                        <Button size="sm" onClick={() => onConfirm(r)} data-confirm-receipt={r.id}>
                          {d.confirm}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onReject(r)}>
                          {d.reject}
                        </Button>
                      </>
                    )}
                    <a
                      href={receiptFile(r.id, 'original')}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(TEXT_LINK, 'inline-flex items-center gap-1 text-[13px]')}
                    >
                      {r.kind === 'pdf' ? d.downloadOriginal : d.openOriginal}
                      <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden />
                    </a>
                  </div>
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

/** A probability in 0..1 as the panel shows it: «0,92». */
const score = (n: number) => n.toFixed(2).replace('.', ',');

/**
 * The receipt AI's answers about one receipt (#32), newest first: when, which provider, how many
 * credits it was shown, its four numbers and what came of it. Read-only: only `confirmed` ever
 * paid anything (ADR 0013); the numbers are for staff and for tuning the thresholds.
 */
function Checks({ checks, t }: { checks: AdminReceiptDto['checks']; t: AdminMessages }) {
  const d = t.orders.detail;
  const keys = ['isReceipt', 'amountMatches', 'recipientMatches', 'choiceConfidence'] as const;
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
                formatTashkent(c.at),
                d.provider[c.provider],
                fill(d.checkMeta, { n: String(c.candidates) }),
              ]}
            />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums sm:grid-cols-4">
              {keys.map((k) => (
                <div key={k} className="flex items-baseline justify-between gap-2 sm:block">
                  <dt className="text-small text-muted-foreground">{d.scores[k]}</dt>
                  <dd className="font-medium">{score(c[k])}</dd>
                </div>
              ))}
            </dl>
            <p className="font-medium">{d.checkOutcome[c.outcome ?? 'waiting']}</p>
            {c.reason && (
              <p className="text-small text-pretty text-muted-foreground [overflow-wrap:anywhere]">
                {c.reason}
              </p>
            )}
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

/** The lines as bought (the snapshot) and the totals, every amount from the server. */
export function LinesSection({ page, t, language }: Props) {
  const d = t.orders.detail;
  const o = page.order;
  const discount = o.discount;
  return (
    <Section title={d.lines}>
      <ul className="-mt-1 divide-y divide-border">
        {o.lines.map((l, i) => (
          <li key={i} className="flex gap-4 py-3 first:pt-0">
            <div className="min-w-0 flex-1">
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
            </div>
            <div className="shrink-0 text-right tabular-nums">
              <p className="font-semibold whitespace-nowrap">
                {formatMoney(l.lineTotal, language)}
              </p>
              {l.markedDown && (
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
        {discount && (
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
      </dl>
    </Section>
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
  const flags = creditFlags(
    { differenceTiyin: credit.link.differenceTiyin, onShopCard: !credit.link.offShopCard },
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
      {flags.map((f) => (
        <span key={f} className="text-small font-medium">
          {f}
        </span>
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
