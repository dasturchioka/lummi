'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { QUIET_ACTION } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

/**
 * The number the shop shows customers for one fragrance («В наличии: N шт.», #83), edited in place:
 * a line with the number and «Изменить», an input with Save / Cancel when open. Empty = the default
 * (setting `stock.shownDefault`); the top is `stock.shownMax`, which the server checks too. Used on
 * the stock page's fragrance row and in the fragrance form; it saves by itself (owner and manager).
 */
export function ShownCountEdit({
  fragranceId,
  name,
  own,
  fallback,
  max,
  t,
  idPrefix = 'shown',
  className,
}: {
  fragranceId: number;
  name: string;
  /** The fragrance's own number; null = the default. */
  own: number | null;
  fallback: number;
  max: number;
  t: AdminMessages;
  /** Both stock layouts exist in the page, so the input id says which. */
  idPrefix?: string;
  className?: string;
}) {
  const s = t.stock;
  const router = useRouter();
  const [value, setValue] = useState<number | null>(own);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<'invalid' | 'failed' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setValue(own), [own]);

  async function save(raw: string) {
    const text = raw.trim();
    const next = text === '' ? null : Number(text);
    if (next !== null && (!/^\d{1,4}$/.test(text) || next < 1 || next > max)) {
      setError('invalid');
      return;
    }
    if (next === value) return setDraft(null);
    setSaving(true);
    setError(null);
    try {
      const res = await browserApi.shownCount.set({
        params: { id: fragranceId },
        body: { shownCount: next },
      });
      if (res.status === 200) {
        setValue(res.body.shownCount);
        setDraft(null);
        setSaved(true);
        router.refresh();
      } else setError(res.status === 422 ? 'invalid' : 'failed');
    } catch {
      setError('failed');
    } finally {
      setSaving(false);
    }
  }

  const inputId = `${idPrefix}-${fragranceId}`;
  if (draft !== null)
    return (
      // a div, not a form: the fragrance form holds this editor and forms do not nest
      <div
        className={cn('grid max-w-[34rem] gap-1.5', className)}
        data-testid={`shown-count-${fragranceId}`}
      >
        <label htmlFor={inputId} className="text-[12.5px] font-medium text-muted-foreground">
          {s.shownLabel}
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={inputId}
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="done"
            placeholder={fill(s.shownDefault, { n: String(fallback) })}
            className="w-32 tabular-nums"
            aria-invalid={error === 'invalid' || undefined}
            aria-describedby={`${inputId}-hint`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save(draft);
              }
            }}
          />
          <Button type="button" loading={saving} onClick={() => void save(draft)}>
            {s.shownSave}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
          >
            {s.shownCancel}
          </Button>
        </div>
        <p id={`${inputId}-hint`} className="text-small text-muted-foreground">
          {fill(s.shownHint, { max: String(max) })}
        </p>
        {error && (
          <p role="alert" className="text-alert text-xs font-medium">
            {error === 'invalid' ? fill(s.shownInvalid, { max: String(max) }) : s.shownFailed}
          </p>
        )}
      </div>
    );
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 text-small', className)}
      data-testid={`shown-count-${fragranceId}`}
    >
      <span>
        <span className="text-muted-foreground">{s.shownLabel}: </span>
        <span className="font-semibold tabular-nums" data-testid="shown-count-value">
          {value === null
            ? fill(s.shownDefault, { n: String(fallback) })
            : fill(s.shownOwn, { n: String(value) })}
        </span>
      </span>
      <button
        type="button"
        className={cn('min-h-9 rounded-sm px-1 text-[13px]', QUIET_ACTION)}
        aria-label={fill(s.shownChangeLabel, { name })}
        onClick={() => {
          setSaved(false);
          setDraft(value === null ? '' : String(value));
        }}
      >
        {s.shownChange}
      </button>
      {saved && (
        <span role="status" className="inline-flex items-center gap-1">
          <Check className="size-3.5 text-sage-ink" strokeWidth={1.5} aria-hidden />
          {s.shownSaved}
        </span>
      )}
    </div>
  );
}
