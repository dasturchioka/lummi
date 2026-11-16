'use client';

import {
  HOME_QUEUES,
  type HomeQueue,
  type HomeQueues,
  type HomeSystem,
  type OwnerHome,
} from '@lummi/contracts';
import { formatMoney, formatTiyin, plural, type Language } from '@lummi/i18n';
import {
  ArrowRight,
  BanknoteArrowDown,
  ChevronRight,
  ReceiptText,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState, type ReactNode } from 'react';
import {
  age,
  change,
  countChange,
  moment,
  QUEUE_HREF,
  stockHalves,
  weekdayOf,
} from '@/lib/home-format';
import { StatAmount, StatCard, StatGrid } from '@/components/ui/stat-card';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';

export type HomeCopy = AdminMessages['home'];

/**
 * A value that changed on a refresh settles out of a 2 px blur (`.motion-settle`). The first
 * value it shows never moves; a new value remounts the span, which replays the animation.
 */
export function Settle({ value, children }: { value: string; children?: ReactNode }) {
  const [shown, setShown] = useState(value);
  const [moved, setMoved] = useState(false);
  if (shown !== value) {
    setShown(value);
    setMoved(true);
  }
  return (
    <span key={value} className={moved ? 'motion-settle' : undefined}>
      {children ?? value}
    </span>
  );
}

/** A template whose `{placeholders}` take nodes (an amount in bold), not only strings. */
export function rich(template: string, values: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key !== undefined && key in values ? values[key] : part}</Fragment>;
  });
}

/** Facts joined with « · », empty ones left out. */
export function joined(parts: ReactNode[]): ReactNode {
  const kept = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  return kept.map((p, i) => (
    <Fragment key={i}>
      {i > 0 && ' · '}
      {p}
    </Fragment>
  ));
}

// ---- the owner's strip

/**
 * Money in today and net sales (owner only): payments confirmed today and their linked credits
 * against the same weekday a week ago, then #42's net sales over 7 days and as 14 bars, today's
 * in Sage. Each label names its measure.
 */
export function SalesStrip({
  copy,
  language,
  data,
}: {
  copy: HomeCopy;
  language: Language;
  data: OwnerHome;
}) {
  const s = copy.sales;
  const { paidToday: now, paidWeekAgo: before, week, previousWeek, days } = data.sales;
  const money = (n: number) => formatMoney(n, language);
  const weekday = weekdayOf(data.at.day);
  const weekChange = change(week.net, previousWeek.net);
  const figs: { key: string; icon: LucideIcon; label: string; value: string; delta: string }[] = [
    {
      key: 'orders',
      icon: ShoppingBag,
      label: s.orders,
      value: String(now.orders),
      delta: countChange(now.orders, before.orders),
    },
    {
      key: 'received',
      icon: BanknoteArrowDown,
      label: s.received,
      value: money(now.received),
      delta: change(now.received, before.received) ?? s.noBase,
    },
    {
      key: 'average',
      icon: ReceiptText,
      label: s.average,
      value: now.average === null ? '—' : money(now.average),
      delta: change(now.average, before.average) ?? s.noBase,
    },
    {
      key: 'week',
      icon: Wallet,
      label: s.week,
      value: money(week.net),
      delta: weekChange ? fill(s.weekVs, { delta: weekChange }) : s.noBase,
    },
  ];
  const top = Math.max(1, ...days.map((d) => d.net));
  const today = days.at(-1);
  const bars = (
    <div
      role="img"
      aria-label={fill(s.barsLabel, { amount: money(today?.net ?? 0) })}
      title={`${s.barsFrom} · ${s.barsToday}`}
      className="flex h-9 w-[min(112px,52%)] items-end gap-[3px]"
    >
      {days.map((d, i) => (
        <i
          key={d.day}
          className={cn(
            'min-h-0.5 flex-1 rounded-t-[2px]',
            i === days.length - 1 ? 'bg-sage' : 'bg-stone',
          )}
          style={{ height: `${Math.round((Math.max(0, d.net) / top) * 100)}%` }}
        />
      ))}
    </div>
  );
  return (
    <section aria-labelledby="home-sales" className="@container">
      <div className="flex items-baseline justify-between gap-4 px-1">
        <h2 id="home-sales" className="text-[15px] leading-[1.35] font-semibold">
          {s.title}{' '}
          <span className="mt-0.5 block text-small font-normal text-muted-foreground sm:mt-0 sm:ml-2 sm:inline">
            {s.vs[weekday]}
          </span>
        </h2>
        <Link
          href="/reports"
          className="inline-flex shrink-0 items-center gap-1.5 border-b border-border-strong pb-px text-sm font-semibold transition-colors hover:border-foreground"
        >
          {s.reports}
          <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
        </Link>
      </div>
      <StatGrid className="mt-3">
        {figs.map((f) => (
          <StatCard
            key={f.key}
            icon={f.icon}
            label={f.label}
            value={
              <Settle value={f.value}>
                <StatAmount text={f.value} />
              </Settle>
            }
            note={<Settle value={f.delta} />}
            aside={f.key === 'week' ? bars : undefined}
          />
        ))}
      </StatGrid>
    </section>
  );
}

// ---- the queue

/** A stock row's name: «Blue Sapphire 30 мл», or the Discovery set. */
export function stockLabel(
  item: { kind: 'volume' | 'discovery'; name: string | null; ml: number | null },
  copy: HomeCopy,
) {
  return item.kind === 'discovery' || item.name === null
    ? 'Discovery set'
    : fill(copy.ml, { name: item.name, ml: String(item.ml) });
}

/**
 * «В работе»: the eight queues in their fixed order, each with its count and its oldest item, a
 * link to its list filtered to exactly those items. Empty rows stay in place, dimmed.
 */
export function QueueCard({
  copy,
  language,
  queues,
  today,
  lifted,
}: {
  copy: HomeCopy;
  language: Language;
  queues: HomeQueues;
  today: string;
  lifted: HomeQueue | null;
}) {
  const oldest = (key: HomeQueue): string => {
    if (queues[key].count === 0) return '—';
    if (key === 'stock') {
      const first = queues.stock.first;
      if (!first) return '—';
      const item = stockLabel(first, copy);
      return queues.stock.count > 1
        ? fill(copy.oldest.stockMore, { item, n: String(queues.stock.count - 1) })
        : fill(copy.oldest.stock, { item });
    }
    const q = queues[key];
    if (q.since === null || q.waitedSeconds === null) return '—';
    if (key === 'receipts') return fill(copy.oldest.receipts, { age: age(q.waitedSeconds, copy) });
    if (key === 'accept') return fill(copy.oldest.accept, { age: age(q.waitedSeconds, copy) });
    if (key === 'credits' && queues.credits.oldestAmountTiyin !== null)
      return fill(copy.oldest.credits, {
        amount: formatTiyin(queues.credits.oldestAmountTiyin, language),
        at: moment(q.since, today, copy.at, language),
      });
    return moment(q.since, today, copy.since, language);
  };
  return (
    <section aria-labelledby="home-queue" className="rounded-card bg-card">
      <div className="px-[18px] pt-4 pb-2.5 sm:px-6 sm:pt-[18px] sm:pb-3">
        <h2 id="home-queue" className="text-[15px] leading-[1.35] font-semibold">
          {copy.queue}
        </h2>
      </div>
      {HOME_QUEUES.map((key) => {
        const n = queues[key].count;
        const zero = n === 0;
        const row = copy.rows[key];
        const when = oldest(key);
        return (
          <Link
            key={key}
            href={QUEUE_HREF[key]}
            className={cn(
              'grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-x-3 border-t border-border px-[18px] py-3 transition-colors duration-150 last:rounded-b-card active:bg-field',
              'sm:min-h-[62px] sm:grid-cols-[minmax(0,1fr)_120px_220px_20px] sm:gap-x-4 sm:px-6 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-milk',
            )}
          >
            <span className="col-start-1 row-start-1 min-w-0">
              <span
                className={cn(
                  'block text-[15px] leading-[1.35]',
                  zero && 'text-muted-foreground',
                  key === lifted && !zero && 'font-semibold',
                )}
              >
                {row.label}
              </span>
              <span
                className={cn('block text-small text-muted-foreground', !zero && 'max-sm:hidden')}
              >
                {row.hint}
              </span>
            </span>
            <span
              className={cn(
                'col-start-2 row-start-1 text-right text-lg leading-[1.2] whitespace-nowrap tabular-nums sm:row-span-1',
                zero ? 'font-medium text-muted-foreground' : 'row-span-2 font-semibold',
              )}
            >
              {key === 'stock' && !zero ? (
                <Settle value={`${queues.stock.out}/${queues.stock.low}`}>
                  {stockHalves(queues.stock).map((half, i) => (
                    <Fragment key={half}>
                      {i > 0 && ' '}
                      {queues.stock[half]}
                      <small className="ml-1 text-small font-medium text-muted-foreground">
                        {copy[half]}
                      </small>
                    </Fragment>
                  ))}
                </Settle>
              ) : (
                <Settle value={String(n)} />
              )}
            </span>
            <span
              // a stock item's name may be long: one line on desktop, two on phones, all of it on hover
              title={key === 'stock' && !zero ? when : undefined}
              className={cn(
                'col-start-1 row-start-2 -mt-0.5 text-small text-muted-foreground sm:col-start-3 sm:row-start-1 sm:mt-0',
                key === 'stock' && 'line-clamp-2 break-words sm:line-clamp-1',
                zero && 'max-sm:hidden',
              )}
            >
              <Settle value={when} />
            </span>
            <span
              className={cn(
                'col-start-3 row-start-1 text-muted-foreground sm:col-start-4 sm:row-span-1',
                !zero && 'row-span-2',
              )}
            >
              <ChevronRight className="size-[18px]" strokeWidth={1.5} aria-hidden />
            </span>
          </Link>
        );
      })}
    </section>
  );
}

// ---- the owner's system line

/** Humo's heartbeat, the last backup and the day's errors; what needs a look turns bold. */
export function SystemLine({
  copy,
  language,
  system,
  today,
}: {
  copy: HomeCopy;
  language: Language;
  system: HomeSystem;
  today: string;
}) {
  const c = copy.system;
  const beat = system.humo.beatSeconds;
  const items: { key: string; text: string; bad: boolean }[] = [
    {
      key: 'humo',
      text:
        beat === null
          ? c.humoNever
          : fill(system.humo.paused ? c.humoPaused : c.humo, { age: age(beat, copy) }),
      bad: system.humo.paused || beat === null,
    },
    {
      key: 'backup',
      text: system.backup.at
        ? fill(c.backup, { at: moment(system.backup.at, today, copy.day, language) })
        : c.backupNever,
      bad: system.backup.stale,
    },
    {
      key: 'errors',
      text: system.errors24h === 0 ? c.errorsNone : plural(language, system.errors24h, c.errors),
      bad: system.errors24h > 0,
    },
  ];
  return (
    <div className="flex flex-wrap gap-x-7 gap-y-2 px-1 text-small text-muted-foreground">
      {items.map((i) => (
        <span
          key={i.key}
          className={cn('inline-flex items-center gap-2', i.bad && 'font-semibold text-foreground')}
        >
          <i
            aria-hidden
            className={cn(
              'size-[7px] shrink-0 rounded-full',
              i.bad ? 'shadow-[inset_0_0_0_1.5px_var(--graphite)]' : 'bg-sage',
            )}
          />
          <Settle value={i.text} />
        </span>
      ))}
    </div>
  );
}
