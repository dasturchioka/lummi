'use client';

import { charCount, type AdminCreditDto } from '@lummi/contracts';
import { formatTiyin, type Language } from '@lummi/i18n';
import { useState, type FormEvent } from 'react';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent } from '@/lib/setting-copy';
import { cn, fill } from '@/lib/utils';
import { Frame } from './order-dialogs';

/** How a mark or an unmark ended: done, or the credit moved on (the list reloads either way). */
export type MarkResult = 'marked' | 'unmarked' | 'taken' | 'changed';

type Props = {
  credit: AdminCreditDto;
  t: AdminMessages;
  language: Language;
  onOpenChange: (open: boolean) => void;
  onDone: (result: MarkResult) => void;
};

/** The credit the dialog is about: its exact amount, then when and to which card. */
function CreditLine({ credit, t, language }: Omit<Props, 'onOpenChange' | 'onDone'>) {
  return (
    <div className="-mt-1 grid gap-1">
      <p className="font-semibold tabular-nums">
        {fill(t.credits.thisCredit, { amount: formatTiyin(credit.amountTiyin, language) })}
      </p>
      <p className="text-small text-muted-foreground tabular-nums">
        {formatTashkent(credit.occurredAt)} · {credit.cardMask}
        {credit.counterparty ? ` · ${credit.counterparty}` : ''}
      </p>
    </div>
  );
}

/**
 * «Не для заказа» (#49): the credit is money that is not for an order (a personal transfer). The
 * text says what follows (out of «Не привязано» and the Home queue, offered to no order); an
 * optional note for staff, within the setting `payments.creditMarkNoteMaxLength`.
 */
export function MarkCreditDialog({
  credit,
  noteMax,
  t,
  language,
  onOpenChange,
  onDone,
}: Props & { noteMax: number }) {
  const c = t.credits;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = charCount(note.trim());
  const tooLong = n > noteMax;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (tooLong) return;
    setBusy(true);
    const res = await browserApi.credits
      .markNotForOrder({
        params: { id: credit.id },
        body: note.trim() ? { note: note.trim() } : {},
      })
      .catch(() => null);
    setBusy(false);
    if (res?.status === 200) return onDone('marked');
    if (res?.status === 409) return onDone(res.body.code === 'credit_taken' ? 'taken' : 'changed');
    if (res?.status === 422) setError(fill(c.markNoteTooLong, { max: String(res.body.max) }));
    else setError(t.errors.generic);
  };

  return (
    <Frame
      open
      onOpenChange={onOpenChange}
      title={c.markTitle}
      description={c.markText}
      onSubmit={submit}
      error={error}
      busy={busy}
      submit={c.markSubmit}
      cancel={t.actions.cancel}
    >
      <CreditLine credit={credit} t={t} language={language} />
      <Field
        id="mark-note"
        label={`${c.markNote} (${c.markNoteOptional})`}
        hint={c.markNoteHint}
        error={tooLong ? fill(c.markNoteTooLong, { max: String(noteMax) }) : undefined}
        aside={
          <span
            className={cn(
              'text-xs text-muted-foreground tabular-nums',
              tooLong && 'font-medium text-foreground',
            )}
          >
            {fill(t.orders.noteCount, { n: String(n), max: String(noteMax) })}
          </span>
        }
      >
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="min-h-16"
        />
      </Field>
    </Frame>
  );
}

/**
 * «Вернуть в поступления» (#49): the mark comes off. It says what follows, since the receipt AI may
 * then pay a waiting order with this credit on its own.
 */
export function UnmarkCreditDialog({ credit, t, language, onOpenChange, onDone }: Props) {
  const c = t.credits;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await browserApi.credits
      .unmarkNotForOrder({ params: { id: credit.id } })
      .catch(() => null);
    setBusy(false);
    if (res?.status === 200) return onDone('unmarked');
    if (res?.status === 409) return onDone(res.body.code === 'credit_taken' ? 'taken' : 'changed');
    setError(t.errors.generic);
  };

  return (
    <Frame
      open
      onOpenChange={onOpenChange}
      title={c.unmarkTitle}
      description={c.unmarkText}
      onSubmit={submit}
      error={error}
      busy={busy}
      submit={c.unmarkSubmit}
      cancel={t.actions.cancel}
    >
      <CreditLine credit={credit} t={t} language={language} />
    </Frame>
  );
}
