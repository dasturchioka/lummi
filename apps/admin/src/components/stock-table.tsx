'use client';

import {
  STOCK_REASON_MAX,
  type FragranceOil,
  type ShownCounts,
  type StockLevel,
  type StockRow,
} from '@lummi/contracts';
import { asDiscoveryVialMl } from '@lummi/contracts/constants';
import { formatMoney, plural, type Language } from '@lummi/i18n';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { ShownCountEdit } from '@/components/stock/shown-count-edit';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { QUIET_ACTION, TEXT_LINK } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

/** What the row's editor is doing. `conflict` carries the count somebody else saved meanwhile. */
type Edit =
  | {
      step: 'typing';
      value: string;
      /** Why the count changed (#76): required, kept in the fragrance's history. */
      reason: string;
      error?: 'invalid' | 'reason' | 'failed' | 'busy';
    }
  | { step: 'below'; value: number; reason: string }
  | { step: 'conflict'; value: number; current: number; reason: string };

/** Highlight without alarm colours (DESIGN.md): Stone for nothing left, Sage wash for running low. */
function StateTag({ level, t }: { level: StockLevel; t: AdminMessages }) {
  if (level === 'ok') return <span className="text-small text-muted-foreground">{t.stock.ok}</span>;
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold',
        level === 'zero' ? 'bg-stone text-graphite' : 'bg-sage-wash text-sage-ink',
      )}
    >
      {level === 'zero' ? t.stock.zero : t.stock.low}
    </span>
  );
}

/** The short tag beside the name in the phone layout, where the state column is not shown. */
function ShortTag({ level, t }: { level: StockLevel; t: AdminMessages }) {
  if (level === 'ok') return null;
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold',
        level === 'zero' ? 'bg-stone text-graphite' : 'bg-sage-wash text-sage-ink',
      )}
    >
      {level === 'zero' ? t.stock.zeroShort : t.stock.lowShort}
    </span>
  );
}

/** A fragrance's oil (#76): none left or running low, in the stock tags' own tones. */
function OilTag({ level, t }: { level: StockLevel; t: AdminMessages }) {
  if (level === 'ok') return null;
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold',
        level === 'zero' ? 'bg-stone text-graphite' : 'bg-sage-wash text-sage-ink',
      )}
    >
      {level === 'zero' ? t.stock.oilZero : t.stock.oilLow}
    </span>
  );
}

/**
 * The fragrance's oil line (#76, ADR 0041): the balance in grams and the litres of perfume it
 * still makes, the low-oil tag, the stock at cost for the owner, and the way to its warehouse page.
 */
function OilLine({
  oil,
  name,
  language,
  t,
}: {
  oil: FragranceOil | undefined;
  name: string;
  language: Language;
  t: AdminMessages;
}) {
  const s = t.stock;
  if (!oil) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-small"
      data-testid={`oil-${oil.fragranceId}`}
      data-level={oil.level}
    >
      <span>
        <span className="text-muted-foreground">{s.oil} </span>
        <span className="font-semibold tabular-nums">
          {fill(s.oilLine, { grams: num(oil.oilGrams), litres: num(oil.liquidLitres) })}
        </span>
      </span>
      <OilTag level={oil.level} t={t} />
      {oil.drafts > 0 && (
        <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-field px-2.5 text-xs font-semibold">
          {fill(s.drafts, { n: num(oil.drafts) })}
        </span>
      )}
      {oil.value?.total != null && (
        <span className="text-muted-foreground tabular-nums">
          {fill(s.value, { sum: formatMoney(oil.value.total, language) })}
        </span>
      )}
      <Link
        href={`/stock/${oil.fragranceId}`}
        className={cn(TEXT_LINK, 'text-small')}
        aria-label={fill(s.openLabel, { name })}
      >
        {s.open}
      </Link>
    </div>
  );
}

/**
 * The stock table (#27). On hand edits inline for owner and manager: the row opens an input; below
 * the reserve it asks first and says why (ADR 0010: allowed, never silent); a 409 shows the count
 * somebody else saved and offers to write the typed number over it. Every save goes through the
 * same two endpoints the volume form and the Discovery page use, with `expected` set to the count
 * the editor was shown.
 */
export function StockTable({
  rows: served,
  oil,
  shown,
  lowThreshold,
  lowOilLitres,
  total,
  language,
  t,
}: {
  rows: StockRow[];
  /** Each fragrance's oil on this page (#76). */
  oil: FragranceOil[];
  /** The numbers shown to customers (#83). */
  shown: ShownCounts;
  lowThreshold: number;
  lowOilLitres: number;
  total: number;
  language: Language;
  t: AdminMessages;
}) {
  const oilOf = new Map(oil.map((o) => [o.fragranceId, o]));
  const router = useRouter();
  /** Rows re-read from the server after a 409, until the page's own refresh brings the same numbers. */
  const [fresh, setFresh] = useState<Record<string, StockRow>>({});
  useEffect(() => setFresh({}), [served]);
  const rows = served.map((r) => fresh[r.key] ?? r);
  const [editing, setEditing] = useState<{ key: string; edit: Edit } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const s = t.stock;

  /** A Discovery set row's `ml` is its vial size (ADR 0042). */
  const setMl = (r: StockRow) => asDiscoveryVialMl(r.ml);
  const label = (r: StockRow) =>
    r.kind === 'discovery'
      ? `${s.discovery} ${fill(s.discoverySub, { ml: String(setMl(r)) })}`
      : `${r.name} ${fill(s.ml, { ml: String(r.ml) })}`;

  const open = (r: StockRow) => {
    setSavedKey(null);
    setEditing({ key: r.key, edit: { step: 'typing', value: String(r.onHand), reason: '' } });
  };
  const close = () => setEditing(null);

  /** The row as the server has it now (its on hand, reserve, available and level), found by its name. */
  async function reread(r: StockRow) {
    const res = await browserApi.stock
      .list({ query: { q: r.kind === 'discovery' ? 'Discovery' : r.name!, page: 1, pageSize: 50 } })
      .catch(() => null);
    const row = res?.status === 200 ? res.body.rows.find((x) => x.key === r.key) : undefined;
    if (row) setFresh((f) => ({ ...f, [r.key]: row }));
  }

  /** One save, always compare-and-set against the count the row showed (or the one the 409 returned). */
  async function save(r: StockRow, onHand: number, expected: number, reason: string) {
    setSaving(r.key);
    const body = { onHand, expected, reason };
    try {
      const res =
        r.kind === 'discovery'
          ? await browserApi.sets.setOnHand({ query: { vialMl: setMl(r) }, body })
          : await browserApi.onHand.set({ params: { id: r.volumeId! }, body });
      if (res.status === 200) {
        close();
        setSavedKey(r.key);
        router.refresh();
      } else if (res.status === 409 && 'current' in res.body && res.body.current !== undefined) {
        // the row shows the server's numbers before the banner does, so the page never holds two counts
        await reread(r);
        setEditing({
          key: r.key,
          edit: { step: 'conflict', value: onHand, current: res.body.current, reason },
        });
        router.refresh();
      } else {
        setEditing({
          key: r.key,
          edit: {
            step: 'typing',
            value: String(onHand),
            reason,
            error: res.status === 409 ? 'busy' : 'failed',
          },
        });
      }
    } catch {
      setEditing({
        key: r.key,
        edit: { step: 'typing', value: String(onHand), reason, error: 'failed' },
      });
    } finally {
      setSaving(null);
    }
  }

  /** Submit from the input: validate, then ask first when it drops below the reserve. */
  function submit(r: StockRow, value: string, typed: string) {
    const reason = typed.trim();
    if (!/^\d{1,7}$/.test(value) || Number(value) > 1_000_000) {
      setEditing({ key: r.key, edit: { step: 'typing', value, reason: typed, error: 'invalid' } });
      return;
    }
    const next = Number(value);
    if (next === r.onHand) return close();
    if (!reason) {
      setEditing({ key: r.key, edit: { step: 'typing', value, reason: typed, error: 'reason' } });
      return;
    }
    if (next < r.reserved) setEditing({ key: r.key, edit: { step: 'below', value: next, reason } });
    else void save(r, next, r.onHand, reason);
  }

  const editor = (r: StockRow, active: Edit, layout: 'block' | 'table') => (
    <Editor
      row={r}
      layout={layout}
      edit={active}
      saving={saving === r.key}
      t={t}
      name={label(r)}
      onChange={(value, reason) =>
        setEditing({ key: r.key, edit: { step: 'typing', value, reason } })
      }
      onSubmit={(value, reason) => submit(r, value, reason)}
      onConfirmBelow={(value, reason) => void save(r, value, r.onHand, reason)}
      onOverwrite={(value, current, reason) => void save(r, value, current, reason)}
      onCancel={close}
      onBack={(value, reason) =>
        setEditing({ key: r.key, edit: { step: 'typing', value: String(value), reason } })
      }
    />
  );
  const changeButton = (r: StockRow) => (
    <button
      type="button"
      className={cn('min-h-9 rounded-sm px-1 text-[13px]', QUIET_ACTION)}
      aria-label={fill(s.changeLabel, { name: label(r) })}
      onClick={() => open(r)}
    >
      {s.change}
    </button>
  );
  const savedMark = (r: StockRow) =>
    savedKey === r.key && (
      <span role="status" className="inline-flex items-center gap-1 text-small">
        <Check className="size-3.5 text-sage-ink" strokeWidth={1.5} aria-hidden />
        {s.saved}
      </span>
    );
  const sub = (r: StockRow) =>
    r.kind === 'discovery'
      ? fill(s.discoverySub, { ml: String(setMl(r)) })
      : [fill(s.ml, { ml: String(r.ml) }), r.hidden ? s.hiddenTag : null]
          .filter(Boolean)
          .join(' · ');
  /** The Discovery set is its own card; a fragrance's volumes (the rows arrive together) share one. */
  const groups = rows.reduce<
    {
      key: string;
      fragranceId: number | null;
      title: string;
      hidden: boolean;
      rows: StockRow[];
    }[]
  >((out, r) => {
    // each Discovery set is a card of its own
    const key = r.kind === 'discovery' ? r.key : `f${r.fragranceId}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else
      out.push({
        key,
        fragranceId: r.fragranceId,
        title: r.kind === 'discovery' ? s.discovery : r.name!,
        hidden: r.hidden,
        rows: [r],
      });
    return out;
  }, []);
  const shownEdit = (fragranceId: number, name: string, layout: 'block' | 'table') => (
    <ShownCountEdit
      fragranceId={fragranceId}
      name={name}
      own={shown.own.find((o) => o.fragranceId === fragranceId)?.shownCount ?? null}
      fallback={shown.default}
      max={shown.max}
      idPrefix={`shown-${layout}`}
      t={t}
    />
  );
  const tone = (level: StockLevel) =>
    level === 'zero' ? 'bg-stone/30' : level === 'low' ? 'bg-sage-wash' : '';

  return (
    <Card className="@container">
      <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
        {plural(language, total, s.total)} · {fill(s.lowHint, { n: num(lowThreshold) })}{' '}
        {fill(s.oilHint, { n: num(lowOilLitres) })}
      </p>
      {/* phones and narrow cards: a card per fragrance with a short line per volume, so reserve and
          available need no side scroll and 60 volumes are not 60 cards */}
      <ul className="divide-y divide-border @3xl:hidden">
        {groups.map((g) => (
          <li key={g.key} data-testid={`stock-card-${g.key}`} className="grid gap-1 px-4 py-3.5">
            <div className="grid min-w-0 gap-1">
              <div>
                <span className="block font-semibold leading-snug [overflow-wrap:anywhere]">
                  {g.title}
                </span>
                {g.hidden && (
                  <span className="block text-small text-muted-foreground">{s.hiddenTag}</span>
                )}
              </div>
              {g.fragranceId !== null && (
                <OilLine oil={oilOf.get(g.fragranceId)} name={g.title} language={language} t={t} />
              )}
              {g.fragranceId !== null && shownEdit(g.fragranceId, g.title, 'block')}
            </div>
            <ul className="grid gap-1.5">
              {g.rows.map((r) => {
                const active = editing?.key === r.key ? editing.edit : null;
                return (
                  <li
                    key={r.key}
                    data-testid={`stock-block-${r.key}`}
                    data-level={r.level}
                    className={cn(
                      'grid gap-1.5 rounded-button px-3 py-2.5',
                      tone(r.level) || 'bg-milk/50',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">
                          {r.kind === 'discovery'
                            ? fill(s.discoverySub, { ml: String(setMl(r)) })
                            : fill(s.ml, { ml: String(r.ml) })}
                        </span>
                        <ShortTag level={r.level} t={t} />
                      </span>
                      {active ? null : (
                        <span className="flex items-center gap-3">
                          {savedMark(r)}
                          {changeButton(r)}
                        </span>
                      )}
                    </div>
                    <dl className="grid grid-cols-3 gap-2">
                      {(
                        [
                          [s.onHand, r.onHand, 'on-hand'],
                          [s.reserved, r.reserved, 'reserved'],
                          [s.available, r.available, 'available'],
                        ] as const
                      ).map(([name, value, id]) => (
                        <div key={id} className="min-w-0">
                          <dt className="text-small text-muted-foreground">{name}</dt>
                          <dd className="font-semibold tabular-nums" data-testid={id}>
                            {num(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {r.belowReserve && (
                      <p className="text-small text-muted-foreground">{s.belowNow}</p>
                    )}
                    {active && editor(r, active, 'block')}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <div className="hidden @3xl:block">
        <Table>
          <THead>
            <TR>
              <TH>{s.fragrance}</TH>
              <TH className="text-right">{s.onHand}</TH>
              <TH className="text-right">{s.reserved}</TH>
              <TH className="text-right">{s.available}</TH>
              <TH>{s.state}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => {
              const active = editing?.key === r.key ? editing.edit : null;
              const firstOfFragrance =
                r.kind === 'volume' && rows[i - 1]?.fragranceId !== r.fragranceId;
              return (
                <Fragment key={r.key}>
                  {firstOfFragrance && (
                    <TR
                      data-testid={`stock-fragrance-f${r.fragranceId}`}
                      className="bg-milk/40 [tbody>&]:hover:bg-milk/40"
                    >
                      <TD colSpan={5} className="h-auto py-3">
                        <div className="grid gap-1">
                          <span className="font-semibold leading-snug [overflow-wrap:anywhere]">
                            {r.name}
                            {r.hidden && (
                              <span className="ml-2 text-small font-normal text-muted-foreground">
                                {s.hiddenTag}
                              </span>
                            )}
                          </span>
                          <OilLine
                            oil={oilOf.get(r.fragranceId!)}
                            name={r.name!}
                            language={language}
                            t={t}
                          />
                          {shownEdit(r.fragranceId!, r.name!, 'table')}
                        </div>
                      </TD>
                    </TR>
                  )}
                  <TR
                    data-testid={`stock-row-${r.key}`}
                    data-level={r.level}
                    className={tone(r.level)}
                  >
                    <TD className="min-w-[13rem] max-w-[22rem]">
                      {r.kind === 'discovery' ? (
                        <>
                          <span className="block font-semibold leading-snug">{s.discovery}</span>
                          <span className="block text-small text-muted-foreground">{sub(r)}</span>
                        </>
                      ) : (
                        // the fragrance's name heads its rows; the volume reads under it
                        <span className="block pl-3 font-medium">
                          {fill(s.ml, { ml: String(r.ml) })}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right whitespace-nowrap">
                      {active ? null : (
                        <span className="inline-flex items-center justify-end gap-3">
                          {savedMark(r)}
                          <span className="font-semibold" data-testid="on-hand">
                            {num(r.onHand)}
                          </span>
                          {changeButton(r)}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right" data-testid="reserved">
                      {num(r.reserved)}
                    </TD>
                    <TD className="text-right font-semibold" data-testid="available">
                      {num(r.available)}
                    </TD>
                    <TD>
                      <StateTag level={r.level} t={t} />
                      {r.belowReserve && (
                        <span className="mt-1 block text-small text-muted-foreground">
                          {s.belowNow}
                        </span>
                      )}
                    </TD>
                  </TR>
                  {active && (
                    <TR className="bg-milk/60">
                      <TD colSpan={5} className="h-auto py-4">
                        {editor(r, active, 'table')}
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

function Editor({
  layout,
  row,
  edit,
  saving,
  name,
  t,
  onChange,
  onSubmit,
  onConfirmBelow,
  onOverwrite,
  onCancel,
  onBack,
}: {
  /** Both layouts exist in the page (one is hidden by CSS), so the input id says which. */
  layout: 'block' | 'table';
  row: StockRow;
  edit: Edit;
  saving: boolean;
  name: string;
  t: AdminMessages;
  onChange: (value: string, reason: string) => void;
  onSubmit: (value: string, reason: string) => void;
  onConfirmBelow: (value: number, reason: string) => void;
  onOverwrite: (value: number, current: number, reason: string) => void;
  onCancel: () => void;
  onBack: (value: number, reason: string) => void;
}) {
  const s = t.stock;
  const inputId = `on-hand-${layout}-${row.key}`;
  const reasonId = `count-reason-${layout}-${row.key}`;
  if (edit.step === 'below') {
    return (
      <div className="grid max-w-[60ch] gap-3">
        <Notice
          title={fill(s.belowTitle, { onHand: num(edit.value), reserved: num(row.reserved) })}
        >
          {fill(s.belowText, { onHand: num(edit.value), reserved: num(row.reserved) })}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button loading={saving} onClick={() => onConfirmBelow(edit.value, edit.reason)}>
            {s.belowConfirm}
          </Button>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onBack(edit.value, edit.reason)}
          >
            {s.back}
          </Button>
        </div>
      </div>
    );
  }
  if (edit.step === 'conflict') {
    return (
      <div className="grid max-w-[60ch] gap-3">
        <Notice title={fill(s.changedTitle, { current: num(edit.current) })}>
          {s.changedText}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button
            loading={saving}
            onClick={() => onOverwrite(edit.value, edit.current, edit.reason)}
          >
            {fill(s.changedConfirm, { value: num(edit.value), current: num(edit.current) })}
          </Button>
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            {s.cancel}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="grid max-w-[34rem] gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(edit.value, edit.reason);
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor={inputId} className="text-[12.5px] font-medium text-muted-foreground">
          {s.newOnHand} · {name}
        </label>
        <Input
          id={inputId}
          autoFocus
          inputMode="numeric"
          pattern="[0-9]+"
          autoComplete="off"
          enterKeyHint="next"
          className="w-32 tabular-nums"
          aria-invalid={edit.error === 'invalid' || undefined}
          value={edit.value}
          onChange={(e) => onChange(e.target.value, edit.reason)}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={reasonId} className="text-[12.5px] font-medium text-muted-foreground">
          {s.reason}
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={reasonId}
            autoComplete="off"
            enterKeyHint="done"
            maxLength={STOCK_REASON_MAX}
            placeholder={s.reasonPlaceholder}
            className="min-w-0 flex-1 basis-56"
            aria-invalid={edit.error === 'reason' || undefined}
            value={edit.reason}
            onChange={(e) => onChange(edit.value, e.target.value)}
          />
          <Button type="submit" loading={saving}>
            {s.save}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
            {s.cancel}
          </Button>
        </div>
      </div>
      {edit.error && (
        <p role="alert" className="text-xs font-medium">
          {edit.error === 'invalid'
            ? s.invalid
            : edit.error === 'reason'
              ? s.reasonRequired
              : edit.error === 'busy'
                ? s.tryAgain
                : s.failed}
        </p>
      )}
    </form>
  );
}
