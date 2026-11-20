'use client';

import type { AdminHome, HomeNow, HomeQueue } from '@lummi/contracts';
import { formatMoney, formatTiyin, plural, type Language } from '@lummi/i18n';
import { ArrowRight, Check, CreditCard } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { age, moment, QUEUE_HREF, stockHalves, threadShare } from '@/lib/home-format';
import { num } from '@/lib/setting-copy';
import { cn, fill } from '@/lib/utils';
import { joined, rich, Settle, stockLabel, type HomeCopy } from './home-parts';

type Action = { href: string; label: string; icon?: 'arrow' | 'card' };

/** What the Now block says about its item. */
type NowContent = {
  title: string;
  facts: ReactNode;
  why: string | null;
  thread?: { share: number; wait: string; end: string };
  secondary?: Action;
  primary?: Action;
};

/** The queue the Now item came from: its row is set in 600 under the block. */
export const LIFTED: Partial<Record<HomeNow['kind'], HomeQueue>> = {
  receipt: 'receipts',
  accept: 'accept',
  assemble: 'assemble',
  bts: 'bts',
  credit: 'credits',
  refund: 'refunds',
  stock: 'stock',
  review: 'reviews',
  humo_pause: 'receipts',
};

const bold = (text: string) => <b className="font-semibold text-milk tabular-nums">{text}</b>;

/** The words, facts and actions for the Now item. */
export function nowContent(data: AdminHome, copy: HomeCopy, language: Language): NowContent | null {
  const c = copy.now;
  const today = data.at.day;
  const q = data.queues;
  const money = (n: number) => formatMoney(n, language);
  const order = (number: number): Action => ({
    href: `/orders/${number}`,
    label: c.open,
    icon: 'arrow',
  });
  const now = data.now;
  const orderFacts = (o: Extract<HomeNow, { kind: 'accept' | 'assemble' | 'bts' }>) => {
    const line = fill(c.line, {
      name: o.line.name[language],
      ml: String(o.line.ml),
      qty: String(o.line.qty),
    });
    return joined([
      o.customer,
      bold(money(o.total)),
      o.moreLines > 0 ? `${line} ${plural(language, o.moreLines, c.moreLines)}` : line,
      fill(c.region, { region: o.region[language] }),
    ]);
  };
  switch (now.kind) {
    case 'clear':
      return null;
    case 'no_card':
      return {
        title: c.noCard.title,
        facts: c.noCard.facts,
        why: null,
        primary: { href: '/shop-card', label: c.noCard.open, icon: 'card' },
      };
    case 'humo_pause':
      return {
        title: fill(c.humo.title, { age: age(now.silentSeconds, copy) }),
        facts: now.lastSignal
          ? rich(c.humo.facts, { at: bold(moment(now.lastSignal, today, copy.at, language)) })
          : c.humo.factsNever,
        why: c.humo.why,
        secondary: { href: '/credits', label: c.humo.credits },
        primary: {
          href: QUEUE_HREF.receipts,
          label: fill(c.humo.receipts, { n: String(q.receipts.count) }),
          icon: 'arrow',
        },
      };
    case 'receipt': {
      const r = c.receipt;
      const reached = now.alerted || now.waitedSeconds >= now.alertSeconds;
      return {
        title: fill(r.title, { number: String(now.number) }),
        facts: joined([
          now.customer,
          rich(r.due, { amount: bold(money(now.amountDue)) }),
          now.credit
            ? rich(r.credit, {
                amount: bold(formatTiyin(now.credit.amountTiyin, language)),
                at: moment(now.credit.at, today, copy.at, language),
                card: now.credit.cardLast4,
              })
            : r.noCredit,
        ]),
        why: r.why[now.reviewReason ?? 'none'],
        thread: {
          share: threadShare(now.waitedSeconds, now.alertSeconds),
          wait: fill(r.wait, { age: age(now.waitedSeconds, copy) }),
          end: reached ? r.sent : fill(r.end, { age: age(now.alertSeconds, copy) }),
        },
        secondary: {
          href: QUEUE_HREF.receipts,
          label: fill(r.all, { n: String(q.receipts.count) }),
        },
        primary: order(now.number),
      };
    }
    case 'accept':
      return {
        title: fill(c.accept.title, {
          number: String(now.number),
          age: age(now.waitedSeconds, copy),
        }),
        facts: orderFacts(now),
        why:
          now.confirmedBy.type === 'staff'
            ? fill(c.accept.whyStaff, {
                name: now.confirmedBy.name ?? '—',
                at: moment(now.since, today, copy.at, language),
              })
            : fill(c.accept.whyAi, { at: moment(now.since, today, copy.at, language) }),
        secondary: {
          href: QUEUE_HREF.accept,
          label: fill(c.accept.all, { n: String(q.accept.count) }),
        },
        primary: order(now.number),
      };
    case 'assemble':
      return {
        title: fill(c.assemble.title, {
          number: String(now.number),
          at: moment(now.since, today, copy.at, language),
        }),
        facts: orderFacts(now),
        why: c.assemble.why,
        secondary: {
          href: QUEUE_HREF.assemble,
          label: fill(c.assemble.all, { n: String(q.assemble.count) }),
        },
        primary: order(now.number),
      };
    case 'bts':
      return {
        title: fill(c.bts.title, {
          number: String(now.number),
          at: moment(now.since, today, copy.since, language),
        }),
        facts: orderFacts(now),
        why: c.bts.why,
        secondary: { href: QUEUE_HREF.bts, label: fill(c.bts.all, { n: String(q.bts.count) }) },
        primary: order(now.number),
      };
    case 'credit':
      return {
        title: fill(c.credit.title, { amount: formatTiyin(now.amountTiyin, language) }),
        facts: joined([
          fill(c.credit.at, {
            at: moment(now.at, today, copy.at, language),
            card: now.cardLast4,
          }),
          !now.onShopCard && c.credit.otherCard,
          now.counterparty,
        ]),
        why: c.credit.why,
        primary: {
          href: QUEUE_HREF.credits,
          label: fill(c.credit.open, { n: String(q.credits.count) }),
          icon: 'arrow',
        },
      };
    case 'refund':
      return {
        title: fill(c.refund[now.status], {
          number: String(now.number),
          amount: money(now.owed),
        }),
        facts: joined([now.customer, fill(c.refund.facts, { age: age(now.waitedSeconds, copy) })]),
        why: c.refund.why,
        secondary: {
          href: QUEUE_HREF.refunds,
          label: fill(c.refund.all, { n: String(q.refunds.count) }),
        },
        primary: order(now.number),
      };
    case 'stock': {
      const item = stockLabel(now.item, copy);
      // each kind in its own unit (ADR 0043): concentrate in ml, boxes and samples in pieces
      const concentrate = now.item.kind === 'fragrance';
      const title =
        now.item.kind === 'fragrance'
          ? now.item.level === 'zero'
            ? fill(c.stock.zeroConcentrate, { item })
            : fill(c.stock.lowConcentrate, { item, n: num(Math.floor(now.item.availableMl)) })
          : now.item.level === 'zero'
            ? fill(c.stock.zero, { item })
            : fill(c.stock.low, { item, n: String(now.item.available) });
      return {
        title,
        facts: joined(
          stockHalves(q.stock).map((half) =>
            fill(half === 'out' ? c.stock.factsOut : c.stock.factsLow, {
              n: String(q.stock[half]),
            }),
          ),
        ),
        why: concentrate || now.item.kind === 'sample' ? c.stock.whyConcentrate : c.stock.whyBoxes,
        primary: { href: QUEUE_HREF.stock, label: c.stock.open, icon: 'arrow' },
      };
    }
    case 'review':
      return {
        title: fill(c.review.title, { number: String(now.number) }),
        facts: joined([
          now.customer,
          fill(c.review.rating, { n: String(now.rating) }),
          now.comment && `«${clip(now.comment, 90)}»`,
        ]),
        why: c.review.why,
        secondary: {
          href: QUEUE_HREF.reviews,
          label: fill(c.review.all, { n: String(q.reviews.count) }),
        },
        // the review itself, where it is published
        primary: { href: `/reviews?order=${now.number}`, label: c.review.open, icon: 'arrow' },
      };
  }
}

/** A comment cut at a word, with an ellipsis, so the facts stay one or two lines. */
function clip(text: string, max: number) {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The sentence a screen reader hears when the Now item changes. */
export function nowAnnouncement(data: AdminHome, copy: HomeCopy, language: Language): string {
  return nowContent(data, copy, language)?.title ?? copy.now.clear.title;
}

/**
 * The Now block: the one item lifted out of the queue, on Graphite (the world's emphasis block),
 * with one sentence, the facts, why it waits, and «Все …» beside «Открыть заказ». A receipt
 * carries the Sage Thread: its wait against the owner's alert. When nothing waits it turns into
 * the calm white «Всё сделано» with the Sage disc. `arrive` is set when the item changed on a
 * refresh; the Thread's node stays mounted for the same item, so its fill grows.
 */
export function NowBlock({
  data,
  copy,
  language,
  arrive,
  refreshSeconds,
}: {
  data: AdminHome;
  copy: HomeCopy;
  language: Language;
  arrive: boolean;
  /** How often the page refreshes (`REFRESH_MS`), for «Всё сделано». */
  refreshSeconds: number;
}) {
  const content = nowContent(data, copy, language);
  if (!content) {
    return (
      <section
        data-now="clear"
        className={cn(
          'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-card bg-card px-[18px] py-5 sm:gap-5 sm:p-6',
          arrive && 'motion-arrive',
        )}
      >
        <span className="grid size-12 place-items-center rounded-full bg-sage text-brand-graphite sm:size-14">
          <Check className="size-[26px]" strokeWidth={1.75} aria-hidden />
        </span>
        <div>
          <h2 className="text-[17px] leading-[1.35] font-semibold text-balance">
            {copy.now.clear.title}
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            {fill(copy.now.clear.why, {
              every: plural(language, refreshSeconds, copy.now.clear.every),
            })}
          </p>
        </div>
      </section>
    );
  }
  const { title, facts, why, thread, secondary, primary } = content;
  return (
    <section
      data-now={data.now.kind}
      className={cn(
        'grid gap-[18px] rounded-card bg-graphite px-[18px] py-5 text-milk sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-x-8 sm:gap-y-5 sm:p-6',
        arrive && 'motion-arrive',
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[17px] leading-[1.35] font-semibold text-balance">{title}</h2>
        {facts && <p className="mt-2 text-[13.5px] text-milk/74">{facts}</p>}
        {why && <p className="mt-2.5 max-w-[62ch] text-sm">{why}</p>}
        {thread && (
          <div className="mt-[18px] max-w-[440px]" role="img" aria-label={thread.wait}>
            <div className="h-0.5 overflow-hidden rounded-[2px] bg-milk/22">
              <div
                className="h-full origin-left rounded-[2px] bg-sage transition-transform duration-500 ease-out motion-reduce:transition-none"
                style={{ transform: `scaleX(${thread.share})` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-[11.5px] text-milk/74 tabular-nums">
              <span>
                <Settle value={thread.wait} />
              </span>
              <span className="ml-auto text-right">{thread.end}</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col-reverse items-stretch gap-2.5 sm:flex-row sm:items-center">
        {secondary && (
          <Button
            asChild
            variant="outline"
            className="h-12 px-[18px] text-milk shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--milk)_22%,transparent)] hover:bg-milk/8"
          >
            <Link href={secondary.href}>{secondary.label}</Link>
          </Button>
        )}
        {primary && (
          <Button asChild className="h-12 bg-milk px-[18px] text-graphite hover:bg-card">
            <Link href={primary.href}>
              {primary.icon === 'card' && <CreditCard strokeWidth={1.5} aria-hidden />}
              {primary.label}
              {primary.icon === 'arrow' && <ArrowRight strokeWidth={1.5} aria-hidden />}
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}

/** A manager cannot set the shop card: a line above the Now block, which keeps their own item. */
export function NoCardLine({ copy }: { copy: HomeCopy }) {
  const c = copy.now.noCard;
  return (
    <div className="flex items-start gap-3 rounded-card bg-field px-[18px] py-3.5 text-sm">
      <CreditCard className="mt-px size-5 shrink-0" strokeWidth={1.5} aria-hidden />
      <p>
        <b className="font-semibold">{c.title}.</b> <span>{c.note}</span>
      </p>
    </div>
  );
}
