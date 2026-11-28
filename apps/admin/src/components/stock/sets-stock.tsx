'use client';

import { MAX_ON_HAND, type StockSetRow } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { LevelTag, levelTone } from '@/components/stock-table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { QUIET_ACTION } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';
import { CountEditor } from './count-editor';
import { useCount, type CountRow } from './use-count';

/**
 * The Discovery sets on the stock page (ADR 0009, 0042, 0043): ready boxes with their own count,
 * held by orders and available. The boxes are counted here with a reason; packing new ones from
 * the five's concentrate is the sets page's «Собрать наборы».
 */
export function SetsStock({
  rows,
  lowThreshold,
  language,
  t,
}: {
  rows: StockSetRow[];
  lowThreshold: number;
  language: Language;
  t: AdminMessages;
}) {
  const s = t.stock;
  // each set by its own name (ADR 0044), its box size beside it
  const name = (r: StockSetRow) =>
    `${r.name[language]} · ${fill(s.discoverySub, { ml: String(r.vialMl) })}`;
  const countRow = (r: StockSetRow): CountRow => ({
    key: r.key,
    onHand: r.onHand,
    reserved: r.reserved,
    unit: 'pcs',
    max: MAX_ON_HAND,
  });
  const count = useCount(async (key, value, expected, reason) => {
    const res = await browserApi.sets.setOnHand({
      query: { key },
      body: { onHand: value, expected, reason },
    });
    if (res.status === 200) return { kind: 'saved' };
    if (res.status === 409 && res.body.current !== undefined)
      return { kind: 'changed', current: res.body.current };
    return { kind: 'failed' };
  });
  if (rows.length === 0) return null;
  return (
    <Card className="@container mb-4">
      <div className="border-b border-border px-4 py-3 @xl:px-5">
        <h2 className="font-semibold">{s.sets}</h2>
        <p className="text-small text-muted-foreground">
          {s.setsHint} {fill(s.setLowHint, { n: num(lowThreshold) })}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const edit = count.editOf(r.key);
          return (
            <li
              key={r.key}
              data-testid={`stock-set-${r.key}`}
              data-level={r.level}
              className={cn('grid gap-2.5 px-4 py-3.5 @xl:px-5', levelTone(r.level))}
            >
              <div className="grid items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(12rem,1fr)_auto]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold leading-snug">{name(r)}</span>
                  {r.level !== 'ok' && (
                    <LevelTag level={r.level} text={r.level === 'zero' ? s.setZero : s.setLow} />
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-x-6 gap-y-1 sm:text-right">
                  {(
                    [
                      [s.onHand, r.onHand, 'on-hand'],
                      [s.reserved, r.reserved, 'reserved'],
                      [s.available, r.available, 'available'],
                    ] as const
                  ).map(([label, value, id]) => (
                    <div key={id} className="min-w-0">
                      <dt className="text-small text-muted-foreground">{label}</dt>
                      <dd className="font-semibold tabular-nums" data-testid={id}>
                        {fill(s.boxes, { n: num(value) })}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              {r.belowReserve && <p className="text-small text-muted-foreground">{s.belowNow}</p>}
              {edit ? (
                <CountEditor
                  id={r.key}
                  label={`${s.newOnHand} · ${name(r)}`}
                  unit="pcs"
                  unitLabel={s.consumables.units.pcs}
                  edit={edit}
                  reserved={r.reserved}
                  saving={count.saving === r.key}
                  t={t}
                  {...count.handlers(countRow(r))}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className={cn('min-h-9 rounded-sm px-1 text-[13px]', QUIET_ACTION)}
                    aria-label={fill(s.changeLabel, { name: name(r) })}
                    onClick={() => count.open(countRow(r))}
                  >
                    {s.change}
                  </button>
                  {count.savedKey === r.key && (
                    <span role="status" className="inline-flex items-center gap-1 text-small">
                      <Check className="size-3.5 text-sage-ink" strokeWidth={1.5} aria-hidden />
                      {s.saved}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
