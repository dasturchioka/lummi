'use client';

import { STOCK_REASON_MAX } from '@lummi/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';

/**
 * A count typed on the stock page (ADR 0010, 0043): a fragrance's ready concentrate in ml (three
 * decimals, a comma or a dot) or a Discovery set's boxes (whole). Below the reserve it asks first
 * and says why (allowed, never silent); a count somebody else saved meanwhile is shown and may be
 * written over. The row owns the request; this is the editor's face and its states.
 */
export type CountEdit =
  | {
      step: 'typing';
      value: string;
      /** Why the count changed: required, kept in the history. */
      reason: string;
      error?: 'invalid' | 'reason' | 'failed' | 'busy';
    }
  | { step: 'below'; value: number; reason: string }
  | { step: 'conflict'; value: number; current: number; reason: string };

export type CountUnit = 'ml' | 'pcs';

/** The typed count, or null when it is not one the unit allows. */
export function parseCount(text: string, unit: CountUnit, max: number): number | null {
  const t = text.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  const ok = unit === 'ml' ? /^\d{1,9}(\.\d{1,3})?$/.test(t) : /^\d{1,9}$/.test(t);
  if (!ok) return null;
  const n = Number(t);
  return n <= max ? n : null;
}

/** A count as the input shows it again: the unit's own spelling, a comma for decimals. */
export const countText = (n: number, unit: CountUnit) =>
  unit === 'ml' ? String(n).replace('.', ',') : String(n);

export function CountEditor({
  id,
  label,
  unit,
  edit,
  reserved,
  unitLabel,
  saving,
  t,
  invalidText,
  onChange,
  onSubmit,
  onConfirmBelow,
  onOverwrite,
  onCancel,
  onBack,
}: {
  /** Unique in the page: both stock layouts exist at once (one hidden by CSS). */
  id: string;
  label: string;
  unit: CountUnit;
  edit: CountEdit;
  /** What open orders hold, in the count's unit. */
  reserved: number;
  /** How the unit reads after a number («мл», «шт.»). */
  unitLabel: string;
  saving: boolean;
  t: AdminMessages;
  /** What a count that does not parse is told, when the unit's own line does not fit (a consumable's top). */
  invalidText?: string;
  onChange: (value: string, reason: string) => void;
  onSubmit: (value: string, reason: string) => void;
  onConfirmBelow: (value: number, reason: string) => void;
  onOverwrite: (value: number, current: number, reason: string) => void;
  onCancel: () => void;
  onBack: (value: number, reason: string) => void;
}) {
  const s = t.stock;
  const amount = (n: number) => `${num(n)} ${unitLabel}`;
  if (edit.step === 'below') {
    return (
      <div className="grid max-w-[60ch] gap-3">
        <Notice
          title={fill(s.belowTitle, { onHand: amount(edit.value), reserved: amount(reserved) })}
        >
          {fill(s.belowText, { onHand: amount(edit.value), reserved: amount(reserved) })}
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
        <Notice title={fill(s.changedTitle, { current: amount(edit.current) })}>
          {s.changedText}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button
            loading={saving}
            onClick={() => onOverwrite(edit.value, edit.current, edit.reason)}
          >
            {fill(s.changedConfirm, { value: amount(edit.value), current: amount(edit.current) })}
          </Button>
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            {s.cancel}
          </Button>
        </div>
      </div>
    );
  }
  const inputId = `count-${id}`;
  const reasonId = `count-reason-${id}`;
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
          {label}
        </label>
        <Input
          id={inputId}
          autoFocus
          inputMode={unit === 'ml' ? 'decimal' : 'numeric'}
          autoComplete="off"
          enterKeyHint="next"
          className="w-36 tabular-nums"
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
        <p role="alert" className="text-alert text-xs font-medium">
          {edit.error === 'invalid'
            ? (invalidText ?? (unit === 'ml' ? s.invalidMl : s.invalid))
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
