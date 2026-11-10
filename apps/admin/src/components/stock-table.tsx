'use client';

import type { StockRow } from '@lummi/contracts';
import { plural, type Language } from '@lummi/i18n';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { QUIET_ACTION } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

type Level = 'zero' | 'low' | 'ok';
const levelOf = (available: number, threshold: number): Level =>
  available === 0 ? 'zero' : available <= threshold ? 'low' : 'ok';

/** What the row's editor is doing. `conflict` carries the count somebody else saved meanwhile. */
type Edit =
  | { step: 'typing'; value: string; error?: 'invalid' | 'failed' | 'busy' }
  | { step: 'below'; value: number }
  | { step: 'conflict'; value: number; current: number };

/** Highlight without alarm colours (DESIGN.md): Stone for nothing left, Sage wash for running low. */
function StateTag({ level, t }: { level: Level; t: AdminMessages }) {
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

/**
 * The stock table (#27). On hand edits inline for owner and manager: the row opens an input; below
 * the reserve it asks first and says why (ADR 0010: allowed, never silent); a 409 shows the count
 * somebody else saved and offers to write the typed number over it. Every save goes through the
 * same two endpoints the volume form and the Discovery page use, with `expected` set to the count
 * the editor was shown.
 */
export function StockTable({
  rows,
  lowThreshold,
  total,
  language,
  t,
}: {
  rows: StockRow[];
  lowThreshold: number;
  total: number;
  language: Language;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ key: string; edit: Edit } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const s = t.stock;

  const label = (r: StockRow) =>
    r.kind === 'discovery' ? s.discovery : `${r.name} ${fill(s.ml, { ml: String(r.ml) })}`;

  const open = (r: StockRow) => {
    setSavedKey(null);
    setEditing({ key: r.key, edit: { step: 'typing', value: String(r.onHand) } });
  };
  const close = () => setEditing(null);

  /** One save, always compare-and-set against the count the row showed (or the one the 409 returned). */
  async function save(r: StockRow, onHand: number, expected: number) {
    setSaving(r.key);
    const body = { onHand, expected };
    try {
      const res =
        r.kind === 'discovery'
          ? await browserApi.sets.setOnHand({ body })
          : await browserApi.onHand.set({ params: { id: r.volumeId! }, body });
      if (res.status === 200) {
        close();
        setSavedKey(r.key);
        router.refresh();
      } else if (res.status === 409 && 'current' in res.body && res.body.current !== undefined) {
        setEditing({
          key: r.key,
          edit: { step: 'conflict', value: onHand, current: res.body.current },
        });
        router.refresh();
      } else {
        setEditing({
          key: r.key,
          edit: {
            step: 'typing',
            value: String(onHand),
            error: res.status === 409 ? 'busy' : 'failed',
          },
        });
      }
    } catch {
      setEditing({ key: r.key, edit: { step: 'typing', value: String(onHand), error: 'failed' } });
    } finally {
      setSaving(null);
    }
  }

  /** Submit from the input: validate, then ask first when it drops below the reserve. */
  function submit(r: StockRow, value: string) {
    if (!/^\d{1,7}$/.test(value) || Number(value) > 1_000_000) {
      setEditing({ key: r.key, edit: { step: 'typing', value, error: 'invalid' } });
      return;
    }
    const next = Number(value);
    if (next === r.onHand) return close();
    if (next < r.reserved) setEditing({ key: r.key, edit: { step: 'below', value: next } });
    else void save(r, next, r.onHand);
  }

  return (
    <Card className="@container">
      <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
        {plural(language, total, s.total)} · {fill(s.lowHint, { n: num(lowThreshold) })}
      </p>
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
          {rows.map((r) => {
            const level = levelOf(r.available, lowThreshold);
            const active = editing?.key === r.key ? editing.edit : null;
            const rowTone =
              level === 'zero' ? 'bg-stone/30' : level === 'low' ? 'bg-sage-wash' : '';
            return (
              <Fragment key={r.key}>
                <TR data-testid={`stock-row-${r.key}`} data-level={level} className={rowTone}>
                  <TD className="min-w-[13rem] max-w-[22rem]">
                    <span className="block font-semibold leading-snug [overflow-wrap:anywhere]">
                      {r.kind === 'discovery' ? s.discovery : r.name}
                    </span>
                    <span className="block text-small text-muted-foreground">
                      {r.kind === 'discovery'
                        ? s.discoverySub
                        : [fill(s.ml, { ml: String(r.ml) }), r.hidden ? s.hiddenTag : null]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    {active ? null : (
                      <span className="inline-flex items-center justify-end gap-3">
                        {savedKey === r.key && (
                          <span role="status" className="inline-flex items-center gap-1 text-small">
                            <Check
                              className="size-3.5 text-sage-ink"
                              strokeWidth={1.5}
                              aria-hidden
                            />
                            {s.saved}
                          </span>
                        )}
                        <span className="font-semibold" data-testid="on-hand">
                          {num(r.onHand)}
                        </span>
                        <button
                          type="button"
                          className={cn('min-h-9 rounded-sm px-1 text-[13px]', QUIET_ACTION)}
                          aria-label={fill(s.changeLabel, { name: label(r) })}
                          onClick={() => open(r)}
                        >
                          {s.change}
                        </button>
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
                    <StateTag level={level} t={t} />
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
                      <Editor
                        row={r}
                        edit={active}
                        saving={saving === r.key}
                        t={t}
                        onChange={(value) =>
                          setEditing({ key: r.key, edit: { step: 'typing', value } })
                        }
                        onSubmit={(value) => submit(r, value)}
                        onConfirmBelow={(value) => void save(r, value, r.onHand)}
                        onOverwrite={(value, current) => void save(r, value, current)}
                        onCancel={close}
                        onBack={(value) =>
                          setEditing({ key: r.key, edit: { step: 'typing', value: String(value) } })
                        }
                        name={label(r)}
                      />
                    </TD>
                  </TR>
                )}
              </Fragment>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

function Editor({
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
  row: StockRow;
  edit: Edit;
  saving: boolean;
  name: string;
  t: AdminMessages;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onConfirmBelow: (value: number) => void;
  onOverwrite: (value: number, current: number) => void;
  onCancel: () => void;
  onBack: (value: number) => void;
}) {
  const s = t.stock;
  const inputId = `on-hand-${row.key}`;
  if (edit.step === 'below') {
    return (
      <div className="sticky left-5 grid w-[min(60ch,calc(100vw-5.5rem))] gap-3">
        <Notice
          title={fill(s.belowTitle, { onHand: num(edit.value), reserved: num(row.reserved) })}
        >
          {fill(s.belowText, { onHand: num(edit.value), reserved: num(row.reserved) })}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button loading={saving} onClick={() => onConfirmBelow(edit.value)}>
            {s.belowConfirm}
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => onBack(edit.value)}>
            {s.back}
          </Button>
        </div>
      </div>
    );
  }
  if (edit.step === 'conflict') {
    return (
      <div className="sticky left-5 grid w-[min(60ch,calc(100vw-5.5rem))] gap-3">
        <Notice title={fill(s.changedTitle, { current: num(edit.current) })}>
          {s.changedText}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button loading={saving} onClick={() => onOverwrite(edit.value, edit.current)}>
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
      className="sticky left-5 grid w-[min(34rem,calc(100vw-5.5rem))] gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(edit.value);
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor={inputId} className="text-[12.5px] font-medium text-muted-foreground">
          {s.newOnHand} · {name}
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={inputId}
            autoFocus
            inputMode="numeric"
            pattern="[0-9]+"
            autoComplete="off"
            enterKeyHint="done"
            className="w-32 tabular-nums"
            aria-invalid={edit.error === 'invalid' || undefined}
            value={edit.value}
            onChange={(e) => onChange(e.target.value)}
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
          {edit.error === 'invalid' ? s.invalid : edit.error === 'busy' ? s.tryAgain : s.failed}
        </p>
      )}
    </form>
  );
}
