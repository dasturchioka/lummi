import type { BroadcastCounts } from '@lummi/contracts';
import { Card } from '@/components/ui/card';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';
import { num } from './format';

/** Share of the deliveries that are settled (sent, not delivered or failed), 0–1. */
export const settled = (c: BroadcastCounts) =>
  c.total === 0 ? 1 : (c.total - c.pending) / c.total;

/**
 * The Sage thread (DESIGN.md): a 2 px hairline track with a Sage fill, the one progress
 * component. The fill scales on the compositor, so a running broadcast moves smoothly.
 */
export function SageThread({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const percent = Math.round(value * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
      className={cn('h-0.5 overflow-hidden rounded-[2px] bg-border', className)}
    >
      <div
        className="h-full origin-left rounded-[2px] bg-sage transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `scaleX(${value})` }}
      />
    </div>
  );
}

/**
 * The counts as one card of cells, each a number over its hint, with the Sage thread and
 * «15 из 24» under them. A running broadcast shows four (sent, not delivered, failed, in the
 * queue: a 2 × 2 grid on a phone, one row from 672 px); a finished one has nothing queued, so it
 * shows three, «Отправлено» across the top on a phone.
 */
export function CountTiles({
  counts,
  sending,
  t,
}: {
  counts: BroadcastCounts;
  sending: boolean;
  t: AdminMessages;
}) {
  const b = t.broadcasts;
  const c = b.counts;
  const done = counts.total - counts.pending;
  const keys = sending || counts.pending > 0 ? FOUR : THREE;
  return (
    <Card className="@container">
      <dl
        className={cn(
          'grid grid-cols-2 [&>div]:min-w-0',
          keys.length === 4 ? '@2xl:grid-cols-4' : '@xl:grid-cols-3',
        )}
      >
        {keys.map((key, i) => (
          <div
            key={key}
            data-count={key}
            className={cn('px-4 py-4 @xl:px-5', cellLines(keys.length, i))}
          >
            <dt className="text-[12.5px] font-medium text-muted-foreground">{c[key]}</dt>
            <dd
              className={cn(
                'mt-1 text-[28px] leading-[1.15] font-semibold tracking-[-0.01em] tabular-nums',
                counts[key] === 0 && key !== 'sent' && 'text-muted-foreground',
              )}
            >
              {num(counts[key])}
            </dd>
            <dd className="mt-1.5 text-xs leading-snug text-pretty text-muted-foreground">
              {c[`${key}Hint`]}
            </dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-border px-4 pt-4 pb-3.5 @xl:px-5">
        <SageThread value={settled(counts)} label={`${c.total}: ${num(counts.total)}`} />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
          <p role="status" className="text-muted-foreground">
            {sending ? b.runningNote : b.doneNote}
          </p>
          <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {fill(b.progress, { done: num(done), total: num(counts.total) })}
          </p>
        </div>
      </div>
    </Card>
  );
}

const FOUR = ['sent', 'blocked', 'failed', 'pending'] as const;
const THREE = ['sent', 'blocked', 'failed'] as const;

/**
 * Hairlines between the cells. Four: a 2 × 2 grid on phones, one row from 672 px. Three: the
 * first across the top on phones (the other two under it), one row from 576 px.
 */
function cellLines(count: 3 | 4, i: number) {
  if (count === 4) {
    return cn(
      i % 2 === 1 && 'border-l border-border',
      i >= 2 && 'border-t border-border @2xl:border-t-0',
      i === 2 && '@2xl:border-l',
    );
  }
  return cn(
    i === 0 && 'col-span-2 @xl:col-span-1',
    i === 1 && 'border-t border-border @xl:border-t-0 @xl:border-l',
    i === 2 && 'border-t border-l border-border @xl:border-t-0',
  );
}
