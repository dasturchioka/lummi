'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { countText, parseCount, type CountEdit, type CountUnit } from './count-editor';

/** What a count's request came back with. */
export type CountAnswer =
  { kind: 'saved' } | { kind: 'changed'; current: number } | { kind: 'busy' } | { kind: 'failed' };

/** One counted row: its key, what it holds now, what orders hold, its unit and the top a count may take. */
export interface CountRow {
  key: string;
  onHand: number;
  reserved: number;
  unit: CountUnit;
  max: number;
}

/**
 * The stock page's count flow, one for every counted row (a fragrance's concentrate, a Discovery
 * set's boxes): open, type with a reason, ask first below the reserve, compare-and-set against the
 * count the row showed (or the one a 409 returned), refresh the page on success.
 */
export function useCount(
  send: (key: string, value: number, expected: number, reason: string) => Promise<CountAnswer>,
) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ key: string; edit: CountEdit } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const set = (key: string, edit: CountEdit) => setEditing({ key, edit });
  const close = () => setEditing(null);

  async function save(r: CountRow, value: number, expected: number, reason: string) {
    setSaving(r.key);
    try {
      const res = await send(r.key, value, expected, reason);
      if (res.kind === 'saved') {
        close();
        setSavedKey(r.key);
        router.refresh();
      } else if (res.kind === 'changed') {
        set(r.key, { step: 'conflict', value, current: res.current, reason });
        router.refresh();
      } else
        set(r.key, {
          step: 'typing',
          value: countText(value, r.unit),
          reason,
          error: res.kind === 'busy' ? 'busy' : 'failed',
        });
    } catch {
      set(r.key, { step: 'typing', value: countText(value, r.unit), reason, error: 'failed' });
    } finally {
      setSaving(null);
    }
  }

  return {
    editing,
    saving,
    savedKey,
    editOf: (key: string) => (editing?.key === key ? editing.edit : null),
    open(r: CountRow) {
      setSavedKey(null);
      set(r.key, { step: 'typing', value: countText(r.onHand, r.unit), reason: '' });
    },
    close,
    handlers(r: CountRow) {
      return {
        onChange: (value: string, reason: string) => set(r.key, { step: 'typing', value, reason }),
        onSubmit: (value: string, typed: string) => {
          const reason = typed.trim();
          const next = parseCount(value, r.unit, r.max);
          if (next === null)
            return set(r.key, { step: 'typing', value, reason: typed, error: 'invalid' });
          if (next === r.onHand) return close();
          if (!reason) return set(r.key, { step: 'typing', value, reason: typed, error: 'reason' });
          if (next < r.reserved) set(r.key, { step: 'below', value: next, reason });
          else void save(r, next, r.onHand, reason);
        },
        onConfirmBelow: (value: number, reason: string) => void save(r, value, r.onHand, reason),
        onOverwrite: (value: number, current: number, reason: string) =>
          void save(r, value, current, reason),
        onCancel: close,
        onBack: (value: number, reason: string) =>
          set(r.key, { step: 'typing', value: countText(value, r.unit), reason }),
      };
    },
  };
}
