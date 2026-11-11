'use client';

import {
  CANCEL_NOTE_MAX,
  charCount,
  cancelReasonsFor,
  RECEIPT_REJECT_REASONS,
  formatLocalDate,
  tashkentDay,
  TRACKING_NUMBER_MAX,
  TRACKING_NUMBER_MIN,
  TYPED_REASON_MAX,
  type AdminOrderDto,
  type CancelReason,
  type CreditOptionDto,
  type CreditOptionsDto,
  type ReceiptRejectReason,
} from '@lummi/contracts';
import { formatCalendarDate, formatMoney, formatTiyin, type Language } from '@lummi/i18n';
import { orderCancelledText, receiptRejectedText } from '@lummi/i18n/bot';
import { CircleAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
import { MetaLine } from '@/components/ui/meta-line';
import { Textarea } from '@/components/ui/textarea';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent } from '@/lib/setting-copy';
import { cn, fill } from '@/lib/utils';

/**
 * Why a move did not go through, for the dialog: the text to show, and, when a credit differs
 * from the order and needs a reason, what differs (#32's `reason_required`).
 */
export type Failure = { text: string; mismatch?: ('amount' | 'card')[] };

/** The parent makes the request; it answers what failed (shown in the dialog), or null to close it. */
export type Submit<B> = (body: B) => Promise<Failure | null>;

type Common = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: AdminOrderDto;
  t: AdminMessages;
};

/** Characters as a person counts them (an emoji is one): the server's own count (`charCount`). */
const length = charCount;

/** «Покупатель получит»: the message exactly as the bot will send it, in the shopper's language. */
function Preview({ label, language, text }: { label: string; language: Language; text: string }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
      <p
        lang={language}
        className="rounded-button bg-field px-3.5 py-3 text-[13.5px] leading-snug whitespace-pre-line [overflow-wrap:anywhere]"
        data-preview
      >
        {text}
      </p>
    </div>
  );
}

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

/** A form dialog with a sticky footer: the shared frame of the order dialogs. */
export function Frame({
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
  summary,
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
  /** A line above the buttons that stays in view with them (what the press will do). */
  summary?: ReactNode;
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
          <div className="sticky bottom-0 z-10 -mx-5 mt-1 border-t border-border bg-card px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 sm:pb-6">
            {summary && <div className="mb-3">{summary}</div>}
            <DialogFooter className="mt-0">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  {cancel}
                </Button>
              </DialogClose>
              <Button type="submit" loading={busy}>
                {submit}
              </Button>
            </DialogFooter>
          </div>
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
    if (failed) setError(failed.text);
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
        <Preview
          label={o.preview}
          language={reader}
          text={receiptRejectedText(reader, page.order.number, reason, trimmed || null)}
        />
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
  const reader: Language = page.customer.language;
  const o = t.orders;
  const status = page.order.status;
  const reasons = cancelReasonsFor('staff', status);
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
    if (failed) setError(failed.text);
  };

  return (
    <Frame
      open={open}
      onOpenChange={onOpenChange}
      title={fill(o.cancelTitle, { number: String(page.order.number) })}
      description={page.payment === 'paid' ? o.cancelPaidText : o.cancelText}
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
          maxLength={CANCEL_NOTE_MAX}
          rows={2}
          className="min-h-16"
        />
      </Field>
      {reason && (
        <Preview
          label={o.preview}
          language={reader}
          text={orderCancelledText(reader, page.order.number, reason, page.payment === 'paid')}
        />
      )}
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
    if (failed) setError(failed.text);
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

/** The staff reason for linking a credit that differs (#32): counted as the server counts it. */
export function LinkReasonField({
  value,
  onChange,
  limits,
  tried,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  limits: AdminOrderDto['limits'];
  tried: boolean;
  t: AdminMessages;
}) {
  const o = t.orders;
  const n = length(value.trim());
  const error =
    n > limits.linkReasonMax
      ? fill(o.linkReasonLong, { max: String(limits.linkReasonMax) })
      : tried && n === 0
        ? o.linkReasonRequired
        : tried && n < limits.linkReasonMin
          ? fill(o.linkReasonShort, { min: String(limits.linkReasonMin) })
          : undefined;
  return (
    <Field
      id="link-reason"
      label={o.linkReason}
      hint={o.linkReasonHint}
      error={error}
      aside={
        <span
          className={cn(
            'text-xs text-muted-foreground tabular-nums',
            n > limits.linkReasonMax && 'font-medium text-foreground',
          )}
        >
          {fill(o.noteCount, { n: String(n), max: String(limits.linkReasonMax) })}
        </span>
      }
    >
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="min-h-16"
      />
    </Field>
  );
}

/** A reason the server will take: within the limits, trimmed. */
export const reasonFits = (reason: string, limits: AdminOrderDto['limits']) => {
  const n = length(reason.trim());
  return n >= limits.linkReasonMin && n <= limits.linkReasonMax;
};

/**
 * How a credit differs from the order: «На 40 000 сум меньше», «Другая карта *9055». Each is a
 * marked line (an icon, semibold Graphite), never red, so a manager cannot miss it (#33).
 */
export function mismatchMarks(
  c: { differenceTiyin: number; onShopCard: boolean; cardLast4: string },
  t: AdminMessages,
  language: Language,
): string[] {
  const o = t.orders;
  const amount = formatTiyin(Math.abs(c.differenceTiyin), language);
  return [
    c.differenceTiyin < 0 && fill(o.markLess, { amount }),
    c.differenceTiyin > 0 && fill(o.markMore, { amount }),
    !c.onShopCard && fill(o.markCard, { last4: c.cardLast4 }),
  ].filter((x): x is string => Boolean(x));
}

/** What linking a credit that differs will do, in one line above the buttons. */
export function mismatchSummary(
  c: { differenceTiyin: number; onShopCard: boolean; cardLast4: string },
  t: AdminMessages,
  language: Language,
): string | null {
  const o = t.orders;
  const amount = formatTiyin(Math.abs(c.differenceTiyin), language);
  const parts = [
    c.differenceTiyin < 0 && fill(o.sumLess, { amount }),
    c.differenceTiyin > 0 && fill(o.sumMore, { amount }),
    !c.onShopCard && fill(o.sumCard, { last4: c.cardLast4 }),
  ].filter((x): x is string => Boolean(x));
  return parts.length > 0 ? parts.join('. ') : null;
}

/** A marked line: the eye stops on it without an alarm colour (DESIGN.md No Alarm Rule). */
export function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-[13px] leading-snug font-semibold text-foreground">
      <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** «К переводу 259 200 сум · карта магазина *7364»: what every credit is measured against. */
export function ReferenceLine({
  page,
  t,
  language,
}: {
  page: AdminOrderDto;
  t: AdminMessages;
  language: Language;
}) {
  const amount = formatMoney(page.order.amountDue, language);
  return (
    <p
      className="-mt-1 rounded-button bg-field px-3.5 py-2.5 text-[14px] font-semibold tabular-nums [overflow-wrap:anywhere]"
      data-reference
    >
      {page.shopCardLast4
        ? fill(t.orders.refLine, { amount, last4: page.shopCardLast4 })
        : fill(t.orders.refNoCard, { amount })}
    </p>
  );
}

/**
 * «Подтвердить оплату»: pick the credit that paid the order, its Candidate credits first and the
 * others behind «Показать другие». A credit of another amount or card asks for a reason (so does
 * the server's `reason_required`, should the shop card have changed meanwhile). With `receiptId`
 * it confirms that receipt; without, a credit that came with no receipt (TZ §4).
 */
export function ConfirmPaymentDialog({
  open,
  onOpenChange,
  page,
  receiptId,
  t,
  language,
  onSubmit,
}: Common & {
  receiptId: number | null;
  language: Language;
  onSubmit: Submit<{ creditId: number; receiptId: number | null; reason?: string }>;
}) {
  const o = t.orders;
  const [options, setOptions] = useState<CreditOptionsDto | 'loading' | 'failed'>('loading');
  const [creditId, setCreditId] = useState<number | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [reason, setReason] = useState('');
  const [mismatch, setMismatch] = useState<Failure['mismatch']>(undefined);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void browserApi.orders
      .creditOptions({ params: { number: page.order.number } })
      .then((res) => live && setOptions(res.status === 200 ? res.body : 'failed'))
      .catch(() => live && setOptions('failed'));
    return () => {
      live = false;
    };
  }, [page.order.number]);

  const all = typeof options === 'object' ? [...options.candidates, ...options.others] : [];
  const selected = all.find((c) => c.id === creditId) ?? null;
  const differs =
    (selected !== null && (selected.differenceTiyin !== 0 || !selected.onShopCard)) ||
    Boolean(mismatch?.length);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (!selected || (differs && !reasonFits(reason, page.limits))) return;
    setBusy(true);
    const failed = await onSubmit({
      creditId: selected.id,
      receiptId,
      ...(differs ? { reason: reason.trim() } : {}),
    });
    setBusy(false);
    if (failed?.mismatch) {
      setMismatch(failed.mismatch);
      setTried(false);
    } else if (failed) setError(failed.text);
  };

  const row = (c: CreditOptionDto) => {
    const marks = mismatchMarks(c, t, language);
    return (
      <label
        key={c.id}
        className="flex cursor-pointer touch-manipulation items-start gap-3 rounded-button px-2.5 py-2 transition-colors duration-150 select-none hover:bg-milk active:bg-field"
        data-credit-option={c.id}
      >
        <input
          type="radio"
          name="credit"
          value={c.id}
          checked={creditId === c.id}
          onChange={() => {
            setCreditId(c.id);
            setMismatch(undefined);
          }}
          className="mt-0.5 size-[18px] shrink-0 accent-graphite"
        />
        <span className="grid min-w-0 gap-0.5">
          <span className="font-semibold whitespace-nowrap tabular-nums">
            {formatTiyin(c.amountTiyin, language)}
          </span>
          <MetaLine
            className="text-small text-muted-foreground tabular-nums"
            parts={[
              formatTashkent(c.occurredAt),
              <span key="card" className="whitespace-nowrap">
                {fill(o.cardShort, { last4: c.cardLast4 })}
              </span>,
              c.counterparty && (
                <span key="from" className="[overflow-wrap:anywhere]">
                  {c.counterparty}
                </span>
              ),
            ]}
          />
          {marks.map((m) => (
            <Mark key={m}>{m}</Mark>
          ))}
        </span>
      </label>
    );
  };

  return (
    <Frame
      open={open}
      onOpenChange={onOpenChange}
      title={fill(o.confirmTitle, { number: String(page.order.number) })}
      description={receiptId === null ? o.confirmNoReceipt : o.confirmText}
      onSubmit={submit}
      error={error}
      busy={busy}
      submit={o.detail.confirm}
      cancel={t.actions.cancel}
      wide
      summary={
        selected && mismatchSummary(selected, t, language) ? (
          <Mark>{mismatchSummary(selected, t, language)}</Mark>
        ) : undefined
      }
    >
      <ReferenceLine page={page} t={t} language={language} />
      {options === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {o.loadingCredits}
        </p>
      ) : options === 'failed' ? (
        <Notice title={o.creditsFailed} />
      ) : (
        <fieldset className="grid gap-1.5" data-credit-options>
          <legend className="mb-1.5 text-[12.5px] font-medium text-muted-foreground">
            {o.candidates}
          </legend>
          {options.candidates.length === 0 ? (
            <p className="text-sm text-pretty text-muted-foreground">{o.noCandidates}</p>
          ) : (
            <div className="-mx-2.5 grid gap-0.5">{options.candidates.map(row)}</div>
          )}
          {options.othersTotal > 0 && !showOthers && (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-3"
                onClick={() => setShowOthers(true)}
              >
                {fill(o.showOthers, { n: String(options.othersTotal) })}
              </Button>
            </div>
          )}
          {showOthers && (
            <div className="mt-2 grid gap-1.5 border-t border-border pt-3">
              <p className="text-[12.5px] font-medium text-muted-foreground">{o.others}</p>
              <div className="-mx-2.5 grid gap-0.5">{options.others.map(row)}</div>
              {options.othersTotal > options.others.length && (
                <p className="text-small text-muted-foreground">
                  {fill(o.othersMore, { n: String(options.others.length) })}
                </p>
              )}
            </div>
          )}
          {options.candidates.length === 0 && options.othersTotal === 0 && (
            <p className="text-sm text-muted-foreground">{o.noOthers}</p>
          )}
          {tried && !selected && (
            <p className="text-xs leading-snug font-medium">{o.chooseCredit}</p>
          )}
        </fieldset>
      )}
      {differs && (
        <LinkReasonField
          value={reason}
          onChange={setReason}
          limits={page.limits}
          tried={tried}
          t={t}
        />
      )}
    </Frame>
  );
}

/** A typed reason (a refund, a return): counted as the server counts it, 1 to `TYPED_REASON_MAX`. */
function TypedReasonField({
  id,
  label,
  hint,
  value,
  onChange,
  tried,
  required,
  long,
  t,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  tried: boolean;
  required: string;
  long: string;
  t: AdminMessages;
}) {
  const n = length(value.trim());
  const error =
    n > TYPED_REASON_MAX
      ? fill(long, { max: String(TYPED_REASON_MAX) })
      : tried && n === 0
        ? required
        : undefined;
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      aside={
        <span
          className={cn(
            'text-xs text-muted-foreground tabular-nums',
            n > TYPED_REASON_MAX && 'font-medium text-foreground',
          )}
        >
          {fill(t.orders.noteCount, { n: String(n), max: String(TYPED_REASON_MAX) })}
        </span>
      }
    >
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="min-h-16"
      />
    </Field>
  );
}

const reasonOk = (reason: string) => {
  const n = length(reason.trim());
  return n >= 1 && n <= TYPED_REASON_MAX;
};

/**
 * «Возврат денег» (ADR 0006, #40): the transfer staff already sent back, recorded: the amount in
 * whole so'm (at most what is left of the payment), the Tashkent day it went and why. The status
 * and the discounts stay, and the shopper gets no message. An order that ended paid starts with
 * what is still owed; the line above the buttons says what the record leaves.
 */
export function RefundDialog({
  open,
  onOpenChange,
  page,
  t,
  language,
  onSubmit,
}: Common & {
  language: Language;
  onSubmit: Submit<{ amount: number; date: string; reason: string }>;
}) {
  const r = t.orders.refund;
  const m = page.money;
  const money = (n: number) => formatMoney(n, language);
  const today = formatLocalDate(tashkentDay(new Date()));
  const from = m.paidOn ?? today;
  const max = m.refundable;
  const [amount, setAmount] = useState(m.owed > 0 ? String(m.owed) : '');
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = amount.replace(/\D/g, '');
  const value = digits === '' ? 0 : Number(digits);
  const amountError =
    value > max
      ? fill(r.amountTooLarge, { max: money(max) })
      : tried && value === 0
        ? r.amountRequired
        : undefined;
  const dateOk = date !== '' && date >= from && date <= today;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (value === 0 || value > max || !dateOk || !reasonOk(reason)) return;
    setBusy(true);
    const failed = await onSubmit({ amount: value, date, reason: reason.trim() });
    setBusy(false);
    if (failed) setError(failed.text);
  };

  const fits = value > 0 && value <= max;
  const summary = !fits
    ? null
    : value === max
      ? fill(r.summaryAll, { amount: money(value) })
      : m.owed > 0
        ? fill(r.summaryOwed, { amount: money(value), rest: money(max - value) })
        : fill(r.summary, { amount: money(value), paid: money(m.paid ?? 0) });

  return (
    <Frame
      open={open}
      onOpenChange={onOpenChange}
      title={fill(r.title, { number: String(page.order.number) })}
      description={r.text}
      onSubmit={submit}
      error={error}
      busy={busy}
      submit={r.submit}
      cancel={r.keep}
      summary={
        summary ? <p className="text-[13px] font-semibold tabular-nums">{summary}</p> : undefined
      }
    >
      <p
        className="-mt-1 rounded-button bg-field px-3.5 py-2.5 text-[14px] font-semibold tabular-nums [overflow-wrap:anywhere]"
        data-reference
      >
        {m.refunded > 0
          ? fill(r.referenceRefunded, {
              paid: money(m.paid ?? 0),
              refunded: money(m.refunded),
              max: money(max),
            })
          : fill(r.reference, { paid: money(m.paid ?? 0), max: money(max) })}
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="refund-amount"
          label={r.amount}
          error={amountError}
          hint={value > 0 ? money(value) : undefined}
        >
          <Input
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="next"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular-nums"
          />
        </Field>
        <Field
          id="refund-date"
          label={r.date}
          // the date spelled out, so the browser's «11/11/2026» cannot be misread
          hint={fill(dateOk ? r.dateHintPicked : r.dateHint, {
            date: dateOk ? formatCalendarDate(date, language, true) : '',
            from: formatCalendarDate(from, language),
          })}
          error={tried && !dateOk ? r.dateInvalid : undefined}
        >
          <Input
            type="date"
            min={from}
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </div>
      <TypedReasonField
        id="refund-reason"
        label={r.reason}
        hint={r.reasonHint}
        value={reason}
        onChange={setReason}
        tried={tried}
        required={r.reasonRequired}
        long={r.reasonLong}
        t={t}
      />
    </Frame>
  );
}

/** What a return does to the discount source the order holds (ADR 0005), in a sentence. */
function discountEffect(
  discount: NonNullable<AdminOrderDto['returnPreview']>['discount'],
  t: AdminMessages,
  language: Language,
): string | null {
  const r = t.orders.ret;
  if (!discount) return null;
  if (discount.type === 'promo_code') return fill(r.promo, { code: discount.code });
  const day = formatCalendarDate(discount.lastDay, language);
  if (discount.type === 'birthday_coupon')
    return fill(discount.lost === null ? r.couponBack : r.couponLost, { day });
  if (discount.lost === 'closed') return r.rightClosed;
  return fill(discount.lost === null ? r.rightBack : r.rightLost, { day });
}

/**
 * «Оформить возврат товара» (ADR 0006, #40): the whole delivered order came back. What the move
 * will do comes first, read from the page's preview (the discount source, the upgrade rights the
 * order opened), then a flag per line for what goes back on hand (none by default: a leaking or
 * opened bottle is never sold again) and the reason. The money still to send back as a Refund
 * stays in the footer beside the button, so nobody confirms without seeing it.
 */
export function ReturnDialog({
  open,
  onOpenChange,
  page,
  t,
  language,
  onSubmit,
}: Common & {
  language: Language;
  onSubmit: Submit<{ reason: string; lines: { position: number; backToStock: boolean }[] }>;
}) {
  const o = t.orders;
  const r = o.ret;
  const d = o.detail;
  const preview = page.returnPreview;
  const positions = preview?.lines ?? [];
  const [flags, setFlags] = useState<boolean[]>(() => positions.map(() => false));
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (!reasonOk(reason)) return;
    setBusy(true);
    const failed = await onSubmit({
      reason: reason.trim(),
      lines: positions.map((l, i) => ({ position: l.position, backToStock: flags[i] ?? false })),
    });
    setBusy(false);
    if (failed) setError(failed.text);
  };

  const flagged = flags.filter(Boolean).length;
  const stock =
    flagged === 0
      ? r.stockNone
      : fill(r.stock, { n: String(flagged), total: String(positions.length) });
  const owed =
    page.money.refundable > 0
      ? fill(r.money, { amount: formatMoney(page.money.refundable, language) })
      : null;
  const effects = [
    preview && discountEffect(preview.discount, t, language),
    ...(preview?.rights ?? [])
      .filter((x) => x.usedBy !== null || !x.ended)
      .map((x) => {
        const values = {
          percent: String(x.percent),
          day: formatCalendarDate(x.lastDay, language),
        };
        return x.usedBy
          ? fill(r.rightSpent, { ...values, number: String(x.usedBy.number) })
          : fill(r.rightClose, values);
      }),
  ].filter((x): x is string => Boolean(x));

  return (
    <Frame
      open={open}
      onOpenChange={onOpenChange}
      title={fill(r.title, { number: String(page.order.number) })}
      description={r.text}
      onSubmit={submit}
      error={error}
      busy={busy}
      submit={r.submit}
      cancel={r.keep}
      wide
      summary={
        <div className="grid gap-1 text-[13px] tabular-nums">
          {owed && (
            <p className="leading-snug text-pretty [overflow-wrap:anywhere]" data-money-owed>
              {owed}
            </p>
          )}
          <p className="font-semibold" data-stock-summary>
            {stock}
          </p>
        </div>
      }
    >
      {effects.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-[12.5px] font-medium text-muted-foreground">{r.effects}</p>
          <ul
            className="grid gap-1.5 rounded-button bg-field px-3.5 py-3 text-[13.5px] leading-snug text-pretty [overflow-wrap:anywhere]"
            data-return-effects
          >
            {effects.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      <fieldset className="grid gap-1.5" data-return-lines>
        <legend className="mb-1 text-[12.5px] font-medium text-muted-foreground">{r.lines}</legend>
        <p className="mb-1 text-xs leading-snug text-pretty text-muted-foreground">{r.linesHint}</p>
        <div className="-mx-2.5 grid gap-0.5">
          {positions.map((l, i) => {
            const line = page.order.lines[i];
            if (!line) return null;
            return (
              <label
                key={l.position}
                className="flex cursor-pointer touch-manipulation items-start gap-3 rounded-button px-2.5 py-2 transition-colors duration-150 select-none hover:bg-milk active:bg-field"
                data-return-line={l.position}
              >
                <input
                  type="checkbox"
                  checked={flags[i] ?? false}
                  onChange={(e) =>
                    setFlags((f) => f.map((v, j) => (j === i ? e.target.checked : v)))
                  }
                  className="mt-0.5 size-[18px] shrink-0 accent-graphite"
                />
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-medium break-words">{line.name[language]}</span>
                  <MetaLine
                    className="text-small text-muted-foreground"
                    parts={[
                      line.kind === 'volume' &&
                        fill(d.qty, { ml: String(line.ml), qty: String(line.qty) }),
                      line.kind !== 'volume' && d.setOf,
                      line.kind !== 'volume' && fill(d.units, { qty: String(line.qty) }),
                    ]}
                  />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <TypedReasonField
        id="return-reason"
        label={r.reason}
        hint={r.reasonHint}
        value={reason}
        onChange={setReason}
        tried={tried}
        required={r.reasonRequired}
        long={r.reasonLong}
        t={t}
      />
    </Frame>
  );
}
