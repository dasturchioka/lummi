import type { BroadcastCounts } from '@lummi/contracts';
import { Card } from '@/components/ui/card';
import type { AdminMessages } from '@/lib/i18n';

const ORDER = ['sent', 'blocked', 'failed', 'pending'] as const;

/** Sent / not delivered / failed / pending as four plain tiles, with a Sage progress bar under them. */
export function CountTiles({ counts, t }: { counts: BroadcastCounts; t: AdminMessages }) {
  const c = t.broadcasts.counts;
  const done = counts.total - counts.pending;
  const percent = counts.total === 0 ? 100 : Math.round((done / counts.total) * 100);
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        {ORDER.map((key) => (
          <Card key={key} className="px-4 py-4" data-count={key}>
            <dt className="text-[12.5px] font-medium text-muted-foreground">{c[key]}</dt>
            <dd className="mt-1 text-[28px] leading-none font-semibold tabular-nums">
              {counts[key]}
            </dd>
            {key !== 'sent' && (
              <p className="mt-2 text-xs leading-snug text-pretty text-muted-foreground">
                {c[`${key}Hint`]}
              </p>
            )}
          </Card>
        ))}
      </dl>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${c.total}: ${counts.total}`}
        className="h-1.5 overflow-hidden rounded-full bg-stone"
      >
        <div
          className="h-full rounded-full bg-sage transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
