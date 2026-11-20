'use client';

import {
  MAX_CONCENTRATE_ML,
  type ShownCounts,
  type StockFragranceRow,
  type StockLevel,
} from '@lummi/contracts';
import { formatMoney, plural, type Language } from '@lummi/i18n';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import { Card } from '@/components/ui/card';
import { CountEditor } from '@/components/stock/count-editor';
import { ShownCountEdit } from '@/components/stock/shown-count-edit';
import { useCount, type CountRow } from '@/components/stock/use-count';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { QUIET_ACTION, TEXT_LINK } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

/** Highlight without alarm colours (DESIGN.md): Stone for nothing left, Sage wash for running low. */
export function LevelTag({ level, text }: { level: Exclude<StockLevel, 'ok'>; text: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold',
        level === 'zero' ? 'bg-stone text-graphite' : 'bg-sage-wash text-sage-ink',
      )}
    >
      {text}
    </span>
  );
}

/** A row's tint: Stone for nothing left, Sage wash for running low (the stock page's own tones). */
export const levelTone = (level: StockLevel) =>
  level === 'zero' ? 'bg-stone/30' : level === 'low' ? 'bg-sage-wash' : '';

/** The concentrate's and the oil's tags; nothing while both are fine. */
function Tags({ r, t }: { r: StockFragranceRow; t: AdminMessages }) {
  const s = t.stock;
  return (
    <>
      {r.level !== 'ok' && <LevelTag level={r.level} text={r.level === 'zero' ? s.zero : s.low} />}
      {r.oilLevel !== 'ok' && (
        <LevelTag level={r.oilLevel} text={r.oilLevel === 'zero' ? s.oilZero : s.oilLow} />
      )}
    </>
  );
}

/**
 * The stock page's fragrances (ADR 0043): per fragrance only its ready concentrate (with what
 * orders hold of it) and its oil, both in ml («Boshqa narsa kerak emas»), its tags, the owner's
 * value, the number shown to customers (#83) and the way to its warehouse page, which has the
 * detail. The concentrate is counted inline by owner and manager with a reason, compare-and-set.
 */
export function StockTable({
  rows,
  shown,
  lowConcentrateMl,
  lowOilMl,
  total,
  language,
  t,
}: {
  rows: StockFragranceRow[];
  /** The numbers shown to customers (#83). */
  shown: ShownCounts;
  lowConcentrateMl: number;
  lowOilMl: number;
  total: number;
  language: Language;
  t: AdminMessages;
}) {
  const s = t.stock;
  const ml = (n: number) => fill(s.mlValue, { ml: num(n) });
  const keyOf = (r: StockFragranceRow) => `f${r.fragranceId}`;
  const countRow = (r: StockFragranceRow): CountRow => ({
    key: keyOf(r),
    onHand: r.concentrateMl,
    reserved: r.reservedMl,
    unit: 'ml',
    max: MAX_CONCENTRATE_ML,
  });
  const count = useCount(async (key, value, expected, reason) => {
    const res = await browserApi.warehouse.countConcentrate({
      params: { id: Number(key.slice(1)) },
      body: { ml: value, expectedMl: expected, reason },
    });
    if (res.status === 200) return { kind: 'saved' };
    if (res.status === 409 && res.body.code === 'changed' && res.body.currentMl !== undefined)
      return { kind: 'changed', current: res.body.currentMl };
    return { kind: res.status === 409 ? 'busy' : 'failed' };
  });

  const editor = (r: StockFragranceRow, layout: 'block' | 'table') => {
    const edit = count.editOf(keyOf(r));
    return edit ? (
      <CountEditor
        id={`${layout}-${keyOf(r)}`}
        label={`${s.newConcentrate} · ${r.name}`}
        unit="ml"
        unitLabel={s.consumables.units.ml}
        edit={edit}
        reserved={r.reservedMl}
        saving={count.saving === keyOf(r)}
        t={t}
        {...count.handlers(countRow(r))}
      />
    ) : null;
  };
  const countButton = (r: StockFragranceRow) => (
    <button
      type="button"
      className={cn('min-h-9 rounded-sm px-1 text-[13px]', QUIET_ACTION)}
      aria-label={fill(s.countLabel, { name: r.name })}
      onClick={() => count.open(countRow(r))}
    >
      {s.count}
    </button>
  );
  const savedMark = (r: StockFragranceRow) =>
    count.savedKey === keyOf(r) && (
      <span role="status" className="inline-flex items-center gap-1 text-small">
        <Check className="size-3.5 text-sage-ink" strokeWidth={1.5} aria-hidden />
        {s.saved}
      </span>
    );
  /** What open orders hold, only while they hold any. */
  const reservedNote = (r: StockFragranceRow) =>
    r.reservedMl > 0 ? fill(s.reservedNote, { reserved: ml(r.reservedMl) }) : null;
  const shownEdit = (r: StockFragranceRow, layout: 'block' | 'table') => (
    <ShownCountEdit
      fragranceId={r.fragranceId}
      name={r.name}
      own={shown.own.find((o) => o.fragranceId === r.fragranceId)?.shownCount ?? null}
      fallback={shown.default}
      max={shown.max}
      idPrefix={`shown-${layout}`}
      t={t}
    />
  );
  /** The owner's value, the drafts waiting and the way to the fragrance's warehouse page. */
  const extras = (r: StockFragranceRow) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-small">
      {r.drafts > 0 && (
        <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-field px-2.5 text-xs font-semibold">
          {fill(s.drafts, { n: num(r.drafts) })}
        </span>
      )}
      {r.value?.total != null && (
        <span className="text-muted-foreground tabular-nums">
          {fill(s.value, { sum: formatMoney(r.value.total, language) })}
        </span>
      )}
      <Link
        href={`/stock/${r.fragranceId}`}
        className={cn(TEXT_LINK, 'text-small')}
        aria-label={fill(s.openLabel, { name: r.name })}
      >
        {s.open}
      </Link>
    </div>
  );

  return (
    <Card className="@container">
      <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
        {plural(language, total, s.total)} ·{' '}
        {fill(s.lowHint, { n: num(lowConcentrateMl), oil: num(lowOilMl) })}
      </p>
      {/* phones and narrow cards: a block per fragrance, its two figures side by side */}
      <ul className="divide-y divide-border @4xl:hidden">
        {rows.map((r) => {
          const active = count.editOf(keyOf(r));
          return (
            <li
              key={keyOf(r)}
              data-testid={`stock-card-${keyOf(r)}`}
              data-level={r.level}
              className="grid gap-2.5 px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 font-semibold leading-snug [overflow-wrap:anywhere]">
                  {r.name}
                </span>
                <Tags r={r} t={t} />
              </div>
              {r.hidden && (
                <span className="-mt-2 text-small text-muted-foreground">{s.hiddenTag}</span>
              )}
              <dl
                className={cn(
                  'grid grid-cols-2 gap-2 rounded-button px-3 py-2.5',
                  levelTone(r.level) || 'bg-milk/50',
                )}
              >
                {(
                  [
                    [s.concentrate, ml(r.concentrateMl), 'concentrate'],
                    [s.oil, ml(r.oilMl), 'oil'],
                  ] as const
                ).map(([name, value, id]) => (
                  <div key={id} className="min-w-0">
                    <dt className="text-small leading-snug text-muted-foreground">{name}</dt>
                    <dd
                      className="font-semibold tabular-nums [overflow-wrap:anywhere]"
                      data-testid={id}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {reservedNote(r) && (
                <p className="-mt-1 text-small text-muted-foreground tabular-nums">
                  {reservedNote(r)}
                </p>
              )}
              {r.belowReserve && <p className="text-small text-muted-foreground">{s.belowNow}</p>}
              {active ? (
                editor(r, 'block')
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {countButton(r)}
                  {savedMark(r)}
                </div>
              )}
              {shownEdit(r, 'block')}
              {extras(r)}
            </li>
          );
        })}
      </ul>
      <div className="hidden @4xl:block">
        <Table>
          <THead>
            <TR>
              <TH>{s.fragrance}</TH>
              <TH className="text-right">{s.concentrate}</TH>
              <TH className="text-right">{s.oil}</TH>
              <TH>{s.state}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const active = count.editOf(keyOf(r));
              return (
                <Fragment key={keyOf(r)}>
                  <TR
                    data-testid={`stock-row-${keyOf(r)}`}
                    data-level={r.level}
                    className={cn('align-top', levelTone(r.level))}
                  >
                    <TD className="h-auto min-w-[14rem] max-w-[24rem] py-3">
                      <div className="grid gap-1.5">
                        <span className="font-semibold leading-snug [overflow-wrap:anywhere]">
                          {r.name}
                          {r.hidden && (
                            <span className="ml-2 text-small font-normal text-muted-foreground">
                              {s.hiddenTag}
                            </span>
                          )}
                        </span>
                        {extras(r)}
                        {shownEdit(r, 'table')}
                      </div>
                    </TD>
                    <TD className="h-auto py-3 text-right">
                      <div className="grid justify-items-end gap-0.5">
                        {active ? null : (
                          <span className="inline-flex items-center justify-end gap-3 whitespace-nowrap">
                            {savedMark(r)}
                            <span className="font-semibold tabular-nums" data-testid="concentrate">
                              {ml(r.concentrateMl)}
                            </span>
                            {countButton(r)}
                          </span>
                        )}
                        {reservedNote(r) && (
                          <span className="text-small text-muted-foreground tabular-nums">
                            {reservedNote(r)}
                          </span>
                        )}
                        {r.belowReserve && (
                          <span className="max-w-[18rem] text-small text-muted-foreground">
                            {s.belowNow}
                          </span>
                        )}
                      </div>
                    </TD>
                    <TD className="h-auto py-3 text-right">
                      <span className="block font-semibold tabular-nums" data-testid="oil">
                        {ml(r.oilMl)}
                      </span>
                      <span className="block text-small text-muted-foreground tabular-nums">
                        {fill(s.oilLine, { grams: num(r.oilGrams) })}
                      </span>
                    </TD>
                    <TD className="h-auto py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {r.level === 'ok' && r.oilLevel === 'ok' ? (
                          <span className="text-small text-muted-foreground">{s.ok}</span>
                        ) : (
                          <Tags r={r} t={t} />
                        )}
                      </div>
                    </TD>
                  </TR>
                  {active && (
                    <TR className="bg-milk/60">
                      <TD colSpan={4} className="h-auto py-4">
                        {editor(r, 'table')}
                      </TD>
                    </TR>
                  )}
                </Fragment>
              );
            })}
          </TBody>
        </Table>
      </div>
    </Card>
  );
}
