'use client';

import {
  BOX_MLS,
  CONSUMABLE_NOTE_MAX,
  CONSUMABLE_USES,
  FLACON_MLS,
  MAX_CONSUMABLE_COUNT,
  type Consumable,
  type ConsumableHistory,
  type ConsumableUse,
} from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { Check, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LevelTag, levelTone } from '@/components/stock-table';
import { HistoryList } from '@/components/warehouse/warehouse-view';
import { CountEditor, parseCount } from './count-editor';
import { useCount, type CountRow } from './use-count';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { QUIET_ACTION } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

type C = AdminMessages['stock']['consumables'];

/** What the dialog is open for. */
type Open = { kind: 'receive' | 'edit' | 'history'; item: Consumable } | { kind: 'add' };

/** A typed whole count (the stock page's one parser), at least `min`. */
const whole = (text: string, min: number): number | null => {
  const n = parseCount(text, 'pcs', MAX_CONSUMABLE_COUNT);
  return n !== null && n >= min ? n : null;
};

/**
 * «Расходники» on the stock page (ADR 0043): flacons, boxes, the ethanol and what staff add, each
 * with its count, threshold and state, «Пересчитайте» after a use found fewer than it took. Staff
 * receive, count (with a reason, compare-and-set), rename, archive and add items, and read each
 * one's history; every change is the API's, audited.
 */
export function ConsumablesSection({
  items,
  language,
  t,
}: {
  items: Consumable[];
  language: Language;
  t: AdminMessages;
}) {
  const c = t.stock.consumables;
  const [open, setOpen] = useState<Open | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const active = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);
  const shown = showArchived ? [...active, ...archived] : active;
  const nameOf = (i: Consumable) => (language === 'uz' ? i.nameUz : i.nameRu);
  const amount = (i: Consumable, n: number) => fill(c.amount, { n: num(n), unit: c.units[i.unit] });
  const useOf = (i: Consumable) =>
    i.use === 'other'
      ? null
      : fill(c.useNote, { use: fill(c.uses[i.use], { ml: String(i.ml ?? '') }) });
  const done = (i: Consumable | null) => {
    setOpen(null);
    setSavedId(i?.id ?? null);
  };
  // a count is the stock page's own inline count (with a reason, compare-and-set); a consumable is
  // never held by orders, so it never asks about a reserve
  const countRow = (i: Consumable): CountRow => ({
    key: `c${i.id}`,
    onHand: i.onHand,
    reserved: 0,
    unit: 'pcs',
    max: MAX_CONSUMABLE_COUNT,
  });
  const count = useCount(async (key, value, expected, reason) => {
    const res = await browserApi.consumables.count({
      params: { id: Number(key.slice(1)) },
      body: { onHand: value, expected, reason },
    });
    if (res.status === 200) return { kind: 'saved' };
    if (res.status === 409 && res.body.code === 'changed' && res.body.current !== undefined)
      return { kind: 'changed', current: res.body.current };
    return { kind: res.status === 409 ? 'busy' : 'failed' };
  });
  const action = (label: string, i: Consumable, kind: Exclude<Open['kind'], 'add'>) => (
    <button
      type="button"
      className={cn('min-h-9 rounded-sm px-1 text-[13px]', QUIET_ACTION)}
      aria-label={`${label}: ${nameOf(i)}`}
      onClick={() => {
        setSavedId(null);
        setOpen({ kind, item: i });
      }}
    >
      {label}
    </button>
  );

  return (
    <Card className="@container mb-4" data-testid="consumables">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 @xl:px-5">
        <div className="grid max-w-[70ch] gap-0.5">
          <h2 className="font-semibold">{c.title}</h2>
          <p className="text-small text-pretty text-muted-foreground">{c.description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen({ kind: 'add' })}>
          <Plus strokeWidth={1.5} aria-hidden />
          {c.add}
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground @xl:px-5">{c.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((i) => (
            <li
              key={i.id}
              data-testid={`consumable-${i.id}`}
              data-level={i.level}
              className={cn(
                'grid gap-x-6 gap-y-2 px-4 py-3 @xl:px-5 @3xl:grid-cols-[minmax(12rem,1fr)_auto_auto] @3xl:items-center',
                !i.archived && levelTone(i.level),
                i.archived && 'text-muted-foreground',
              )}
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold leading-snug [overflow-wrap:anywhere]">
                    {nameOf(i)}
                  </span>
                  {i.archived && (
                    <span className="inline-flex h-6 items-center rounded-full bg-field px-2.5 text-xs font-semibold">
                      {c.archived}
                    </span>
                  )}
                  {!i.archived && i.level !== 'ok' && (
                    <LevelTag level={i.level} text={i.level === 'zero' ? c.zero : c.low} />
                  )}
                  {i.needsRecount && (
                    <span
                      className="inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold shadow-[inset_0_0_0_1.5px_var(--graphite)]"
                      title={c.recountHint}
                    >
                      {c.recount}
                    </span>
                  )}
                  {i.isPlaceholder && !i.archived && (
                    <span
                      className="inline-flex h-6 items-center whitespace-nowrap rounded-full bg-field px-2.5 text-xs font-semibold"
                      title={c.placeholderHint}
                    >
                      {c.placeholder}
                    </span>
                  )}
                </span>
                {useOf(i) && <span className="text-small text-muted-foreground">{useOf(i)}</span>}
                {i.needsRecount && (
                  <span className="text-small text-muted-foreground @3xl:hidden">
                    {c.recountHint}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-6 @3xl:text-right">
                <div>
                  <dt className="text-small text-muted-foreground">{c.onHand}</dt>
                  <dd className="font-semibold tabular-nums" data-testid="on-hand">
                    {amount(i, i.onHand)}
                  </dd>
                </div>
                <div>
                  <dt className="text-small text-muted-foreground">{c.threshold}</dt>
                  <dd className="tabular-nums">{amount(i, i.lowThreshold)}</dd>
                </div>
              </dl>
              <div className="-mx-1 flex flex-wrap items-center gap-x-2 @3xl:justify-end">
                {action(c.receive, i, 'receive')}
                <button
                  type="button"
                  className={cn('min-h-9 rounded-sm px-1 text-[13px]', QUIET_ACTION)}
                  aria-label={`${c.count}: ${nameOf(i)}`}
                  onClick={() => {
                    setSavedId(null);
                    count.open(countRow(i));
                  }}
                >
                  {c.count}
                </button>
                {action(c.history, i, 'history')}
                {action(c.edit, i, 'edit')}
                {(savedId === i.id || count.savedKey === `c${i.id}`) && (
                  <span role="status" className="inline-flex items-center gap-1 text-small">
                    <Check className="size-3.5 text-sage-ink" strokeWidth={1.5} aria-hidden />
                    {c.saved}
                  </span>
                )}
              </div>
              {count.editOf(`c${i.id}`) && (
                <div className="@3xl:col-span-3">
                  <CountEditor
                    id={`consumable-${i.id}`}
                    label={`${fill(c.newOnHand, { unit: c.units[i.unit] })} · ${nameOf(i)}`}
                    unit="pcs"
                    unitLabel={c.units[i.unit]}
                    invalidText={fill(c.wholeNumber, { min: '0' })}
                    edit={count.editOf(`c${i.id}`)!}
                    reserved={0}
                    saving={count.saving === `c${i.id}`}
                    t={t}
                    {...count.handlers(countRow(i))}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <div className="border-t border-border px-4 py-2 @xl:px-5">
          <button
            type="button"
            className={cn('min-h-9 rounded-sm px-1 text-[13px]', QUIET_ACTION)}
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? c.hideArchived : fill(c.showArchived, { n: num(archived.length) })}
          </button>
        </div>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent
          className={open?.kind === 'history' ? 'sm:w-[min(560px,calc(100vw-32px))]' : undefined}
        >
          {open?.kind === 'receive' && (
            <ReceiveForm
              item={open.item}
              c={c}
              failed={t.stock.failed}
              name={nameOf(open.item)}
              onDone={done}
              onCancel={() => setOpen(null)}
            />
          )}
          {open?.kind === 'edit' && (
            <EditForm
              item={open.item}
              c={c}
              name={nameOf(open.item)}
              onDone={done}
              onCancel={() => setOpen(null)}
            />
          )}
          {open?.kind === 'add' && <AddForm c={c} onDone={done} onCancel={() => setOpen(null)} />}
          {open?.kind === 'history' && (
            <HistoryView item={open.item} name={nameOf(open.item)} language={language} t={t} />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function useSubmit() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    pending,
    error,
    setError,
    async run<T>(send: () => Promise<T>, after: (res: T) => string | null) {
      setPending(true);
      setError(null);
      try {
        const res = await send();
        const problem = after(res);
        if (problem) setError(problem);
        else router.refresh();
      } catch {
        setError('failed');
      } finally {
        setPending(false);
      }
    },
  };
}

function Footer({
  pending,
  submit,
  cancel,
  onCancel,
}: {
  pending: boolean;
  submit: string;
  cancel: string;
  onCancel: () => void;
}) {
  return (
    <DialogFooter className="mt-2">
      <Button type="button" variant="outline" onClick={onCancel}>
        {cancel}
      </Button>
      <Button type="submit" loading={pending}>
        {submit}
      </Button>
    </DialogFooter>
  );
}

function ReceiveForm({
  item,
  name,
  c,
  failed,
  onDone,
  onCancel,
}: {
  item: Consumable;
  name: string;
  c: C;
  failed: string;
  onDone: (i: Consumable) => void;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [bad, setBad] = useState(false);
  const submit = useSubmit();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = whole(quantity, 1);
        setBad(n === null);
        if (n === null) return;
        void submit.run(
          () =>
            browserApi.consumables.receive({
              params: { id: item.id },
              body: { quantity: n, ...(note.trim() ? { note: note.trim() } : {}) },
            }),
          (res) => (res.status === 201 ? (onDone(res.body), null) : 'failed'),
        );
      }}
    >
      <DialogTitle>{fill(c.receiveTitle, { name })}</DialogTitle>
      <DialogDescription>
        {fill(c.amount, { n: num(item.onHand), unit: c.units[item.unit] })}
      </DialogDescription>
      <div className="mt-5 grid gap-4">
        <Field
          id="receive-qty"
          label={fill(c.quantity, { unit: c.units[item.unit] })}
          error={bad ? fill(c.wholeNumber, { min: '1' }) : undefined}
        >
          <Input
            autoFocus
            inputMode="numeric"
            autoComplete="off"
            className="w-40 tabular-nums"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field id="receive-note" label={c.note}>
          <Input
            autoComplete="off"
            maxLength={CONSUMABLE_NOTE_MAX}
            placeholder={c.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {submit.error && <Notice title={failed} />}
        <Footer pending={submit.pending} submit={c.receive} cancel={c.cancel} onCancel={onCancel} />
      </div>
    </form>
  );
}

function EditForm({
  item,
  name,
  c,
  onDone,
  onCancel,
}: {
  item: Consumable;
  name: string;
  c: C;
  onDone: (i: Consumable) => void;
  onCancel: () => void;
}) {
  const [nameRu, setNameRu] = useState(item.nameRu);
  const [nameUz, setNameUz] = useState(item.nameUz);
  const [low, setLow] = useState(String(item.lowThreshold));
  const [archived, setArchived] = useState(item.archived);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const submit = useSubmit();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fix = new Set<string>();
        if (!nameRu.trim()) fix.add('nameRu');
        if (!nameUz.trim()) fix.add('nameUz');
        const n = whole(low, 0);
        if (n === null) fix.add('low');
        setBad(fix);
        if (fix.size || n === null) return;
        void submit.run(
          () =>
            browserApi.consumables.update({
              params: { id: item.id },
              body: { nameRu: nameRu.trim(), nameUz: nameUz.trim(), lowThreshold: n, archived },
            }),
          (res) =>
            res.status === 200
              ? (onDone(res.body), null)
              : res.status === 409 && res.body.code === 'link_taken'
                ? c.linkTaken
                : c.invalid,
        );
      }}
    >
      <DialogTitle>{fill(c.editTitle, { name })}</DialogTitle>
      <div className="mt-5 grid gap-4">
        <Field
          id="edit-name-ru"
          label={c.nameRu}
          error={bad.has('nameRu') ? c.required : undefined}
        >
          <Input
            autoComplete="off"
            maxLength={80}
            value={nameRu}
            onChange={(e) => setNameRu(e.target.value)}
          />
        </Field>
        <Field
          id="edit-name-uz"
          label={c.nameUz}
          error={bad.has('nameUz') ? c.required : undefined}
        >
          <Input
            autoComplete="off"
            maxLength={80}
            value={nameUz}
            onChange={(e) => setNameUz(e.target.value)}
          />
        </Field>
        <Field
          id="edit-low"
          label={`${c.lowThreshold}, ${c.units[item.unit]}`}
          error={bad.has('low') ? fill(c.wholeNumber, { min: '0' }) : undefined}
        >
          <Input
            inputMode="numeric"
            autoComplete="off"
            className="w-40 tabular-nums"
            value={low}
            onChange={(e) => setLow(e.target.value)}
          />
        </Field>
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--graphite)]"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{c.archive}</span>
            <span className="text-small text-muted-foreground">{c.archiveHint}</span>
          </span>
        </label>
        {submit.error && <Notice title={submit.error === 'failed' ? c.invalid : submit.error} />}
        <Footer pending={submit.pending} submit={c.save} cancel={c.cancel} onCancel={onCancel} />
      </div>
    </form>
  );
}

function AddForm({
  c,
  onDone,
  onCancel,
}: {
  c: C;
  onDone: (i: Consumable) => void;
  onCancel: () => void;
}) {
  const [nameRu, setNameRu] = useState('');
  const [nameUz, setNameUz] = useState('');
  const [use, setUse] = useState<ConsumableUse>('other');
  const [ml, setMl] = useState('');
  const [unit, setUnit] = useState<'pcs' | 'ml'>('pcs');
  const [low, setLow] = useState('0');
  const [bad, setBad] = useState<Set<string>>(new Set());
  const submit = useSubmit();
  const mls: readonly number[] = use === 'flacon' ? FLACON_MLS : use === 'box' ? BOX_MLS : [];
  // the link decides the unit: a flacon or a box is counted in pieces, the ethanol in ml
  const fixedUnit = use === 'flacon' || use === 'box' ? 'pcs' : use === 'ethanol' ? 'ml' : null;
  const unitNow = fixedUnit ?? unit;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fix = new Set<string>();
        if (!nameRu.trim()) fix.add('nameRu');
        if (!nameUz.trim()) fix.add('nameUz');
        if (mls.length && !mls.includes(Number(ml))) fix.add('ml');
        const n = whole(low, 0);
        if (n === null) fix.add('low');
        setBad(fix);
        if (fix.size || n === null) return;
        void submit.run(
          () =>
            browserApi.consumables.create({
              body: {
                nameRu: nameRu.trim(),
                nameUz: nameUz.trim(),
                unit: unitNow,
                use,
                ml: mls.length ? Number(ml) : null,
                lowThreshold: n,
              },
            }),
          (res) =>
            res.status === 201
              ? (onDone(res.body), null)
              : res.status === 409 && res.body.code === 'link_taken'
                ? c.linkTaken
                : c.invalid,
        );
      }}
    >
      <DialogTitle>{c.addTitle}</DialogTitle>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field id="add-name-ru" label={c.nameRu} error={bad.has('nameRu') ? c.required : undefined}>
          <Input
            autoFocus
            autoComplete="off"
            maxLength={80}
            value={nameRu}
            onChange={(e) => setNameRu(e.target.value)}
          />
        </Field>
        <Field id="add-name-uz" label={c.nameUz} error={bad.has('nameUz') ? c.required : undefined}>
          <Input
            autoComplete="off"
            maxLength={80}
            value={nameUz}
            onChange={(e) => setNameUz(e.target.value)}
          />
        </Field>
        <Field id="add-use" label={c.use} className="sm:col-span-2">
          <Select
            value={use}
            onChange={(e) => {
              setUse(e.target.value as ConsumableUse);
              setMl('');
            }}
          >
            {CONSUMABLE_USES.map((u) => (
              <option key={u} value={u}>
                {fill(c.uses[u], { ml: '…' })}
              </option>
            ))}
          </Select>
        </Field>
        {mls.length > 0 && (
          <Field id="add-ml" label={c.ml} error={bad.has('ml') ? c.required : undefined}>
            <Select value={ml} onChange={(e) => setMl(e.target.value)}>
              <option value="">—</option>
              {mls.map((m) => (
                <option key={m} value={String(m)}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="add-unit" label={c.unit}>
          <Select
            value={unitNow}
            disabled={fixedUnit !== null}
            onChange={(e) => setUnit(e.target.value as 'pcs' | 'ml')}
          >
            <option value="pcs">{c.units.pcs}</option>
            <option value="ml">{c.units.ml}</option>
          </Select>
        </Field>
        <Field
          id="add-low"
          label={`${c.lowThreshold}, ${c.units[unitNow]}`}
          error={bad.has('low') ? fill(c.wholeNumber, { min: '0' }) : undefined}
        >
          <Input
            inputMode="numeric"
            autoComplete="off"
            className="tabular-nums"
            value={low}
            onChange={(e) => setLow(e.target.value)}
          />
        </Field>
        {submit.error && (
          <div className="sm:col-span-2">
            <Notice title={submit.error === 'failed' ? c.invalid : submit.error} />
          </div>
        )}
        <div className="sm:col-span-2">
          <Footer pending={submit.pending} submit={c.add} cancel={c.cancel} onCancel={onCancel} />
        </div>
      </div>
    </form>
  );
}

function HistoryView({
  item,
  name,
  language,
  t,
}: {
  item: Consumable;
  name: string;
  language: Language;
  t: AdminMessages;
}) {
  const c = t.stock.consumables;
  const [data, setData] = useState<ConsumableHistory | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    browserApi.consumables
      .history({ params: { id: item.id } })
      .then((res) => live && setData(res.status === 200 ? res.body : 'failed'))
      .catch(() => live && setData('failed'));
    return () => {
      live = false;
    };
  }, [item.id]);
  return (
    <>
      <DialogTitle>{fill(c.historyTitle, { name })}</DialogTitle>
      <DialogDescription>
        {fill(c.amount, { n: num(item.onHand), unit: c.units[item.unit] })}
      </DialogDescription>
      <div className="mt-4 grid gap-2" aria-busy={data === null}>
        {data === null ? (
          <div className="grid gap-2" aria-hidden>
            {[0, 1, 2].map((k) => (
              <div key={k} className="h-14 animate-pulse rounded-button bg-field" />
            ))}
          </div>
        ) : data === 'failed' ? (
          <Notice title={t.stock.failed} />
        ) : data.moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.historyEmpty}</p>
        ) : (
          <HistoryList history={data.moves} language={language} w={t.warehouse} withSubject />
        )}
      </div>
    </>
  );
}
