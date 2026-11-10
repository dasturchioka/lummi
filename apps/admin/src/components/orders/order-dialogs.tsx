'use client';

import {
  CANCEL_REASON_ONLY_FROM,
  CANCEL_REASONS_BY_ACTOR,
  PAID_STATUSES,
  RECEIPT_REJECT_REASONS,
  TRACKING_NUMBER_MAX,
  TRACKING_NUMBER_MIN,
  type AdminOrderDto,
  type CancelReason,
  type ReceiptRejectReason,
} from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { receiptRejectedText } from '@lummi/i18n/bot';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';

/** The parent makes the request; it answers an error to show in the dialog, or null to close it. */
export type Submit<B> = (body: B) => Promise<string | null>;

type Common = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: AdminOrderDto;
  t: AdminMessages;
};

/** Characters as a person counts them (an emoji is one), as the server counts the note. */
const length = (s: string) => [...s].length;

/** One tap target per reason, the width of the dialog, washed while pressed (the composer's list). */
function ReasonList<R extends string>({
  name,
  legend,
  reasons,
  labels,
  value,
  onChange,
  error,
}: {
  name: string;
  legend: string;
  reasons: readonly R[];
  labels: Record<R, string>;
  value: R | null;
  onChange: (r: R) => void;
  error?: string;
}) {
  return (
    <fieldset className="grid gap-1.5" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="mb-1.5 text-[12.5px] font-medium text-muted-foreground">{legend}</legend>
      <div className="-mx-2.5 grid gap-0.5 sm:grid-cols-2">
        {reasons.map((r) => (
          <label
            key={r}
            className="flex min-h-10 cursor-pointer touch-manipulation items-center gap-3 rounded-button px-2.5 py-1.5 leading-snug transition-colors duration-150 select-none hover:bg-milk active:bg-field"
          >
            <input
              type="radio"
              name={name}
              value={r}
              checked={value === r}
              onChange={() => onChange(r)}
              className="size-[18px] shrink-0 accent-graphite"
            />
            <span className="min-w-0 font-medium">{labels[r]}</span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${name}-error`} className="text-xs leading-snug font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function Frame({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  error,
  busy,
  submit,
  cancel,
  wide,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onSubmit: (e: FormEvent) => void;
  error: string | null;
  busy: boolean;
  submit: string;
  cancel: string;
  /** 520 px from 640 px up, for two columns of reasons. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      {/* the footer carries the bottom padding, so it can stick to the edge while the form scrolls */}
      <DialogContent className={cn('pb-0 sm:pb-0', wide && 'sm:w-[min(520px,calc(100vw-32px))]')}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-5">
          {children}
          {error && <Notice title={error} />}
          {/* the actions stay in reach while a long form scrolls under them */}
          <DialogFooter className="sticky bottom-0 z-10 -mx-5 mt-1 border-t border-border bg-card px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 sm:pb-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                {cancel}
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              {submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Отклонить чек»: a preset reason (what the shopper reads, in their language) and a note in the
 * manager's own words, required for «Другая причина», within the setting's limit. Below them, the
 * message exactly as the shopper will get it.
 */
export function RejectDialog({
  open,
  onOpenChange,
  page,
  receiptId,
  t,
  onSubmit,
}: Common & {
  receiptId: number;
  onSubmit: Submit<{ receiptId: number; reason: ReceiptRejectReason; note?: string }>;
}) {
  const o = t.orders;
  const [reason, setReason] = useState<ReceiptRejectReason | null>(null);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = page.limits.rejectNoteMax;
  const trimmed = note.trim();
  const reasonError = tried && !reason ? o.chooseReason : undefined;
  const noteError =
    length(trimmed) > max
      ? fill(o.rejectNoteTooLong, { max: String(max) })
      : tried && reason === 'other' && !trimmed
        ? o.rejectNoteRequired
        : undefined;
  const reader: Language = page.customer.language;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (!reason || (reason === 'other' && !trimmed) || length(trimmed) > max) return;
    setBusy(true);
    const failed = await onSubmit({ receiptId, reason, ...(trimmed ? { note: trimmed } : {}) });
    setBusy(false);
    if (failed) setError(failed);
  };

  return (
    <Frame
      open={open}
      onOpenChange={onOpenChange}
      title={o.rejectTitle}
      description={o.rejectText}
      onSubmit={submit}
      error={error}
      busy={busy}
      submit={o.detail.reject}
      cancel={t.actions.cancel}
      wide
    >
      <ReasonList
        name="reject-reason"
        legend={o.rejectReason}
        reasons={RECEIPT_REJECT_REASONS}
        labels={o.rejectReasons}
        value={reason}
        onChange={setReason}
        error={reasonError}
      />
      <Field
        id="reject-note"
        label={reason === 'other' ? o.rejectNote : `${o.rejectNote} (${o.rejectNoteOptional})`}
        hint={o.readsIn[reader]}
        error={noteError}
        aside={
          <span
            className={cn(
              'text-xs text-muted-foreground tabular-nums',
              length(trimmed) > max && 'font-medium text-foreground',
            )}
          >
            {fill(o.noteCount, { n: String(length(trimmed)), max: String(max) })}
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
      {reason && (
        <div className="grid gap-1.5">
          <p className="text-[12.5px] font-medium text-muted-foreground">{o.preview}</p>
          <p
            lang={reader}
            className="rounded-button bg-field px-3.5 py-3 text-[13.5px] leading-snug whitespace-pre-line [overflow-wrap:anywhere]"
            data-preview
          >
            {receiptRejectedText(reader, page.order.number, reason, trimmed || null)}
          </p>
        </div>
      )}
    </Frame>
  );
}

/**
 * «Отменить заказ»: a staff reason from the TZ §6 list («Не забрал в BTS» only for a parcel
 * handed over) and a note kept in the history. The text says what follows, and for a paid order
 * that the money goes back.
 */
export function CancelDialog({
  open,
  onOpenChange,
  page,
  t,
  onSubmit,
}: Common & { onSubmit: Submit<{ reason: CancelReason; note?: string }> }) {
  const o = t.orders;
  const status = page.order.status;
  const reasons = CANCEL_REASONS_BY_ACTOR.staff.filter((r) => {
    const only = CANCEL_REASON_ONLY_FROM[r];
    return !only || only === status;
  });
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (!reason) return;
    setBusy(true);
    const trimmed = note.trim();
    const failed = await onSubmit({ reason, ...(trimmed ? { note: trimmed } : {}) });
    setBusy(false);
    if (failed) setError(failed);
  };

  return (
    <Frame
      open={open}
      onOpenChange={onOpenChange}
      title={fill(o.cancelTitle, { number: String(page.order.number) })}
      description={PAID_STATUSES.includes(status) ? o.cancelPaidText : o.cancelText}
      onSubmit={submit}
      error={error}
      busy={busy}
      submit={o.step.cancel}
      cancel={o.keep}
      wide
    >
      <ReasonList
        name="cancel-reason"
        legend={o.cancelReason}
        reasons={reasons}
        labels={o.cancelReasons}
        value={reason}
        onChange={setReason}
        error={tried && !reason ? o.chooseReason : undefined}
      />
      <Field id="cancel-note" label={o.cancelNote} hint={o.cancelNoteHint}>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="min-h-16"
        />
      </Field>
    </Frame>
  );
}

/** «Передать в BTS»: the tracking number the shopper gets in the message, trimmed, 6+ characters. */
export function HandToBtsDialog({
  open,
  onOpenChange,
  page,
  t,
  onSubmit,
}: Common & { onSubmit: Submit<{ trackingNumber: string }> }) {
  const o = t.orders;
  const [value, setValue] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();
  const short = trimmed.length < TRACKING_NUMBER_MIN;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (short) return;
    setBusy(true);
    const failed = await onSubmit({ trackingNumber: trimmed });
    setBusy(false);
    if (failed) setError(failed);
  };

  return (
    <Frame
      open={open}
      onOpenChange={onOpenChange}
      title={fill(o.handTitle, { number: String(page.order.number) })}
      description={o.handText}
      onSubmit={submit}
      error={error}
      busy={busy}
      submit={o.step.hand_to_bts}
      cancel={t.actions.cancel}
    >
      <Field
        id="tracking"
        label={o.trackingLabel}
        error={
          tried && short ? fill(o.trackingShort, { min: String(TRACKING_NUMBER_MIN) }) : undefined
        }
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={TRACKING_NUMBER_MAX}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="done"
          className="tracking-[0.04em] tabular-nums"
        />
      </Field>
    </Frame>
  );
}
