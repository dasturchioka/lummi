'use client';

import { Minus, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';
import { FIELD_LABEL, Segmented, useViewNav } from './controls';
import { MAX_LINES, MAX_QTY, type FragranceOption, type SimLine } from './view';

/** The value of the Discovery set in a fragrance select (fragrance ids are positive numbers). */
const SET = 'set';

function FragranceSelect({
  id,
  value,
  options,
  setAvailable,
  onChange,
  t,
  ariaLabel,
}: {
  id?: string;
  value: string;
  options: readonly FragranceOption[];
  setAvailable: boolean;
  onChange: (value: string) => void;
  t: AdminMessages;
  ariaLabel?: string;
}) {
  const p = t.profitability;
  return (
    <Select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {value === '' && <option value="">{p.calculator.pick}</option>}
      {setAvailable && <option value={SET}>{p.discoverySetFull}</option>}
      {options.map((o) => (
        <option key={o.id} value={String(o.id)}>
          {o.name}
        </option>
      ))}
    </Select>
  );
}

/**
 * The calculator's sale: one fragrance and its volume, or the Discovery set. A new fragrance keeps
 * the volume when it is sold in it, else takes its largest.
 */
export function CalculatorPicker({
  options,
  setAvailable,
  t,
}: {
  options: readonly FragranceOption[];
  setAvailable: boolean;
  t: AdminMessages;
}) {
  const p = t.profitability;
  const { view, go } = useViewNav();
  const chosen = options.find((o) => o.id === view.fragrance) ?? null;
  const value = view.set ? SET : chosen ? String(chosen.id) : '';
  const pickFragrance = (v: string) => {
    if (v === SET) return go({ set: true });
    const next = options.find((o) => String(o.id) === v);
    if (!next) return;
    const ml =
      view.calcMl !== null && next.mls.includes(view.calcMl) ? view.calcMl : next.mls.at(-1);
    go({ set: false, fragrance: next.id, calcMl: ml ?? null });
  };
  return (
    <div className="grid gap-4">
      <Field id="calc-fragrance" label={p.calculator.fragrance}>
        <FragranceSelect
          value={value}
          options={options}
          setAvailable={setAvailable}
          onChange={pickFragrance}
          t={t}
        />
      </Field>
      {chosen && !view.set && (
        <div className="grid gap-1.5">
          <span className={FIELD_LABEL}>{p.volume}</span>
          {chosen.mls.length === 0 ? (
            <p className="text-sm text-muted-foreground">{p.calculator.noVolumes}</p>
          ) : (
            <Segmented
              label={p.volume}
              current={view.calcMl === null ? null : String(view.calcMl)}
              items={chosen.mls.map((ml) => ({
                key: String(ml),
                label: fill(p.ml, { ml: String(ml) }),
              }))}
              onPick={(ml) => go({ calcMl: Number(ml) })}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The simulator's lines: a fragrance (or the Discovery set), its volume, a quantity stepper and
 * «Убрать». Each change goes to the URL; the server prices the order.
 */
export function OrderLinesEditor({
  options,
  setAvailable,
  t,
}: {
  options: readonly FragranceOption[];
  setAvailable: boolean;
  t: AdminMessages;
}) {
  const p = t.profitability;
  const o = p.order;
  const { view, go } = useViewNav();
  const lines = view.lines;
  const set = (i: number, line: SimLine) =>
    go({ lines: lines.map((l, k) => (k === i ? line : l)) });
  const remove = (i: number) => go({ lines: lines.filter((_, k) => k !== i) });
  const first = options.find((x) => x.mls.length > 0);
  const add = () => {
    const last = lines.at(-1);
    const line: SimLine | null = last
      ? { item: last.item, qty: 1 }
      : first
        ? { item: { fragrance: first.id, ml: first.mls[0]! }, qty: 1 }
        : setAvailable
          ? { item: 'set', qty: 1 }
          : null;
    if (line) go({ lines: [...lines, line] });
  };
  const pickFragrance = (i: number, v: string) => {
    const line = lines[i]!;
    if (v === SET) return set(i, { item: 'set', qty: line.qty });
    const next = options.find((x) => String(x.id) === v);
    if (!next || next.mls.length === 0) return;
    const ml = line.item !== 'set' && next.mls.includes(line.item.ml) ? line.item.ml : next.mls[0]!;
    set(i, { item: { fragrance: next.id, ml }, qty: line.qty });
  };
  const step =
    'size-9 rounded-full text-foreground shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-[background-color,transform] duration-150 ease-out hover:bg-field active:scale-[0.97] disabled:text-faint disabled:shadow-[inset_0_0_0_1px_var(--hairline)] disabled:active:scale-100 grid place-items-center';

  return (
    <div className="grid gap-4">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{o.empty}</p>
      ) : (
        <ol className="grid gap-3">
          {lines.map((l, i) => {
            const fragrance =
              l.item === 'set'
                ? null
                : options.find((x) => x.id === (l.item as { fragrance: number }).fragrance);
            const label = fill(o.line, { n: String(i + 1) });
            return (
              <li
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-b border-border pb-3 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_7.5rem_auto_auto]"
                aria-label={label}
              >
                <FragranceSelect
                  ariaLabel={`${label}: ${p.calculator.fragrance}`}
                  value={l.item === 'set' ? SET : fragrance ? String(fragrance.id) : ''}
                  options={options}
                  setAvailable={setAvailable}
                  onChange={(v) => pickFragrance(i, v)}
                  t={t}
                />
                <button
                  type="button"
                  aria-label={`${o.remove}: ${label}`}
                  onClick={() => remove(i)}
                  className={cn(step, 'border-0 shadow-none hover:bg-field sm:order-last')}
                >
                  <X className="size-4" strokeWidth={1.5} aria-hidden />
                </button>
                {l.item === 'set' ? (
                  <span className="hidden sm:block" />
                ) : (
                  <Select
                    aria-label={`${label}: ${p.volume}`}
                    value={String(l.item.ml)}
                    onChange={(e) =>
                      l.item !== 'set' &&
                      set(i, { item: { ...l.item, ml: Number(e.target.value) }, qty: l.qty })
                    }
                  >
                    {(fragrance?.mls ?? [l.item.ml]).map((ml) => (
                      <option key={ml} value={String(ml)}>
                        {fill(p.ml, { ml: String(ml) })}
                      </option>
                    ))}
                  </Select>
                )}
                <div
                  role="group"
                  aria-label={`${label}: ${o.qty}`}
                  className="flex items-center gap-1.5"
                >
                  <button
                    type="button"
                    className={step}
                    disabled={l.qty <= 1}
                    aria-label={`${o.qty} −1`}
                    onClick={() => set(i, { ...l, qty: l.qty - 1 })}
                  >
                    <Minus className="size-4" strokeWidth={1.5} aria-hidden />
                  </button>
                  <output className="w-7 text-center font-semibold tabular-nums">{l.qty}</output>
                  <button
                    type="button"
                    className={step}
                    disabled={l.qty >= MAX_QTY}
                    aria-label={`${o.qty} +1`}
                    onClick={() => set(i, { ...l, qty: l.qty + 1 })}
                  >
                    <Plus className="size-4" strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={lines.length >= MAX_LINES || (!first && !setAvailable)}
        >
          <Plus strokeWidth={1.5} aria-hidden />
          {o.add}
        </Button>
      </div>
    </div>
  );
}
