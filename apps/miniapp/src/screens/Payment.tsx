import type { OrderDto, PaymentDto, ReceiptSummaryDto } from '@lummi/contracts';
import {
  groupCardNumber,
  RECEIPT_ACCEPT,
  type ReceiptUploadError,
} from '@lummi/contracts/constants';
import { fill, formatDateTime, formatDayMonth, formatTime, plural } from '@lummi/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CancelOrder } from '../orders/CancelOrder';
import { StatusPill, Timeline } from '../orders/parts';
import {
  holdPolls,
  ORDERS_KEY,
  orderKey,
  paymentKey,
  usePayment,
  useOrdersText,
} from '../orders/queries';
import { precheckReceipt, uploadReceipt, UploadNetworkError } from '../orders/upload';
import { copyText } from '../lib/clipboard';
import { formatFileSize } from '../lib/format';
import { usePrefs } from '../lib/prefs';
import { hapticSuccess, openManagerChat } from '../lib/telegram';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CardIcon, CopyIcon, ImageIcon, UploadIcon } from '../orders/icons';
import { AlertIcon, BoxIcon, CheckIcon, ClockIcon, DocIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { Thumb } from '../ui/Thumb';

const PAID_ON_THE_WAY = new Set(['payment_confirmed', 'accepted', 'assembling']);
const EASE_OUT = 'ease-[cubic-bezier(0.23,1,0.32,1)]';
const LINK =
  'rounded-btn font-medium underline decoration-line-strong underline-offset-[3px] transition-[text-decoration-color,opacity] duration-150 hover:decoration-current active:opacity-60';

/** «ОПЛАТА» with the status, and the order number under it (mockups 07, 12, 13). */
function Head({ order }: { order: OrderDto }) {
  const o = useOrdersText();
  return (
    <>
      <ScreenHeader title={o.payment.title} trailing={<StatusPill status={order.status} />} />
      <p className="type-small -mt-2 mb-4 text-muted" data-testid="pay-order">
        {fill(o.orders.number, { number: String(order.number) })}
      </p>
    </>
  );
}

/** «Вопрос по оплате? Написать менеджеру» under the screen's content. */
function ManagerLine() {
  const { customer } = usePrefs();
  const o = useOrdersText();
  const username = customer?.config.managerUsername;
  if (!username) return null;
  return (
    <p className="type-small mt-6 mb-2 text-center">
      <span className="text-muted">{o.payment.question}</span>{' '}
      <button
        type="button"
        onClick={() => openManagerChat(username)}
        data-testid="write-manager"
        className={`-my-3 px-1 py-3 text-ink ${LINK}`}
      >
        {o.orders.writeManager}
      </button>
    </p>
  );
}

/**
 * A short confirmation over the dock («Скопировано»), read out by screen readers. It rises in,
 * stays, and fades out; a failure stays longer, since it says what to do instead. A copy while
 * one is on screen keeps it there rather than replaying its entrance.
 */
function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const { id, ok, leaving } = toast;
    const timer = setTimeout(
      () => setToast((t) => (t?.id !== id ? t : leaving ? null : { ...t, leaving: true })),
      leaving ? 160 : ok ? 1600 : 4000,
    );
    return () => clearTimeout(timer);
  }, [toast]);
  const view = (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
      style={{ bottom: 'calc(max(12px, var(--safe-b, 0px)) + 82px)' }}
    >
      {toast ? (
        <span
          key={toast.ok ? 'ok' : 'failed'}
          className={`type-small inline-flex max-w-[340px] items-start gap-2 bg-btn px-4 py-2.5 font-medium text-pretty text-btn-ink ${
            toast.leaving
              ? 'animate-[fade-out_0.16s_ease-out_forwards]'
              : 'animate-[rise-in_0.22s_cubic-bezier(0.23,1,0.32,1)]'
          } ${toast.ok ? 'rounded-pill' : 'rounded-card'}`}
        >
          <span className="mt-px shrink-0">
            {toast.ok ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
          </span>
          {toast.text}
        </span>
      ) : null}
    </div>
  );
  return {
    show: (text: string, ok: boolean) => setToast({ text, ok, id: Date.now() }),
    view,
  };
}
type Toast = { text: string; ok: boolean; id: number; leaving?: boolean };

/**
 * A 48 px outlined square that copies `value` (the bank app takes plain digits). Once copied, its
 * icon turns into a Sage Ink check for a moment, where the thumb is, beside the toast.
 */
function CopyButton({
  value,
  label,
  onCopied,
  testId,
}: {
  value: string;
  label: string;
  onCopied: (ok: boolean) => void;
  testId: string;
}) {
  const [copiedAt, setCopiedAt] = useState(0);
  useEffect(() => {
    if (!copiedAt) return;
    const timer = setTimeout(() => setCopiedAt(0), 1400);
    return () => clearTimeout(timer);
  }, [copiedAt]);
  const done = copiedAt > 0;
  const swap = `[grid-area:1/1] transition-[opacity,transform,filter] duration-200 ${EASE_OUT}`;
  const away = 'scale-[0.6] opacity-0 blur-[2px]';
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      data-copied={done || undefined}
      onClick={async () => {
        const ok = await copyText(value);
        if (ok) setCopiedAt(Date.now());
        onCopied(ok);
      }}
      className={`grid size-12 shrink-0 place-items-center rounded-btn text-ink inset-line transition-[transform,background-color] duration-150 ${EASE_OUT} active:scale-[0.95] active:bg-field`}
    >
      <span className={`${swap} ${done ? away : ''}`}>
        <CopyIcon size={20} />
      </span>
      <span className={`${swap} text-sage-ink ${done ? '' : away}`}>
        <CheckIcon size={20} />
      </span>
    </button>
  );
}

/**
 * The amount and the card (mockup 07): the Amount due at 28 px, the card number in groups of four,
 * each with «Скопировать», then the holder. The amount always comes from the server.
 */
function TransferCard({
  order,
  card,
  onCopied,
}: {
  order: OrderDto;
  card: NonNullable<PaymentDto['card']>;
  onCopied: (ok: boolean) => void;
}) {
  const o = useOrdersText();
  return (
    <Card className="p-4" data-testid="transfer">
      <p className="type-small text-muted">{o.payment.amount}</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        {/* a long press takes the whole value, for when the copy button cannot reach the clipboard */}
        <Money amount={order.amountDue} size="amount" className="min-w-0 select-all" />
        <CopyButton
          value={String(order.amountDue)}
          label={o.payment.copyAmount}
          onCopied={onCopied}
          testId="copy-amount"
        />
      </div>
      <p className="type-small mt-2 text-pretty text-muted">{o.payment.amountHint}</p>
      <div className="mt-4 border-t border-line pt-4">
        <p className="type-small text-muted">{o.payment.card}</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          {/* DESIGN.md: 18 px / 600 with +0.04em, so the groups read digit by digit */}
          <p
            className="min-w-0 font-ui text-[18px] leading-tight font-semibold tracking-[0.04em] whitespace-nowrap tabular-nums text-ink select-all"
            data-testid="card-number"
          >
            {groupCardNumber(card.number)}
          </p>
          <CopyButton
            value={card.number}
            label={o.payment.copyCard}
            onCopied={onCopied}
            testId="copy-card"
          />
        </div>
        <Holder holder={card.holder} />
      </div>
    </Card>
  );
}

/**
 * «Получатель: <holder>»: the name in ink, since it is what the shopper checks against the name
 * the bank app shows before the transfer goes.
 */
function Holder({ holder }: { holder: string }) {
  const o = useOrdersText();
  const [before = '', after = ''] = o.payment.holder.split('{holder}');
  return (
    <p className="type-small mt-2 text-pretty break-words text-muted" data-testid="card-holder">
      {before}
      <span className="font-medium text-ink">{holder}</span>
      {after}
    </p>
  );
}

/**
 * A deadline sentence with a clock: «Оплатите до …» on the payment screen, «Ароматы
 * забронированы до …» without a card. The time stays on one line with the word after it (UZ
 * «gacha»); `then` follows as the next sentence.
 */
function Deadline({
  template,
  until,
  then,
  testId,
  className = '',
}: {
  template: string;
  until: string;
  then?: string;
  testId: string;
  className?: string;
}) {
  const { language } = usePrefs();
  const [before = '', after = ''] = template.split('{until}');
  const [, glue = '', rest = ''] = /^(\s?\S*)(.*)$/s.exec(after) ?? [];
  return (
    <p className={`type-body flex items-start gap-2.5 text-ink ${className}`} data-testid={testId}>
      <span className="mt-0.5 shrink-0 text-muted">
        <ClockIcon size={20} />
      </span>
      <span className="text-pretty">
        {before}
        <span className="whitespace-nowrap">
          <b className="font-semibold">{formatDateTime(until, language)}</b>
          {glue}
        </span>
        {rest}
        {then ? ` ${then}` : null}
      </span>
    </p>
  );
}

/**
 * No shop card (the owner took it off) while the order waits: nowhere to transfer now, so this note
 * stands where the card was. A shopper who paid before still sends the receipt (spec Changes
 * 2026-11-10, #28 ruling).
 */
function NoCard() {
  const o = useOrdersText();
  return (
    <Card className="flex items-start gap-3.5 p-4" data-testid="no-card">
      <span className="grid size-12 shrink-0 place-items-center rounded-pill bg-block text-ink">
        <CardIcon size={22} />
      </span>
      <span className="min-w-0">
        {/* a state title (DESIGN.md Heading): the note leads, ahead of the status pill */}
        <span className="type-heading block text-pretty text-ink">
          {o.payment.unavailableTitle}
        </span>
        <span className="type-small mt-1 block text-pretty text-muted">
          {o.payment.unavailableText}
        </span>
      </span>
    </Card>
  );
}

/**
 * Why the order waits for payment again (#36): its last receipt found no transfer in the wait
 * window, or repeated another order's. The bot said so too, but not every shopper reads the bot.
 */
function LastReceiptNote({ receipt }: { receipt: ReceiptSummaryDto | undefined }) {
  const { language } = usePrefs();
  const o = useOrdersText();
  if (receipt?.state !== 'not_found' && receipt?.state !== 'repeat') return null;
  const repeat = receipt.state === 'repeat';
  return (
    <Card className="mb-4 flex items-start gap-3.5 p-4" data-testid="last-receipt-note">
      <span className="grid size-12 shrink-0 place-items-center rounded-pill bg-block text-ink">
        <AlertIcon size={22} />
      </span>
      <span className="min-w-0">
        <span className="type-heading block text-pretty text-ink">
          {repeat ? o.payment.repeatTitle : o.payment.noTransferTitle}
        </span>
        <span className="type-small mt-1 block text-pretty text-muted">
          {repeat
            ? o.payment.repeatText
            : fill(o.payment.noTransferText, {
                day: formatDayMonth(receipt.createdAt, language),
                time: formatTime(receipt.createdAt),
              })}
        </span>
      </span>
    </Card>
  );
}

/** Numbered in Sage-outlined circles (DESIGN.md Payment). */
function Steps() {
  const o = useOrdersText();
  const steps = [o.payment.steps.transfer, o.payment.steps.save, o.payment.steps.upload];
  return (
    <ol className="mt-5 flex flex-col gap-3">
      {steps.map((text, i) => (
        <li key={text} className="flex items-start gap-3">
          <span className="type-small grid size-7 shrink-0 place-items-center rounded-pill font-semibold text-ink shadow-[inset_0_0_0_1.5px_var(--c-sage)]">
            {i + 1}
          </span>
          <span className="type-body pt-0.5 text-pretty text-ink">{text}</span>
        </li>
      ))}
    </ol>
  );
}

type Upload =
  | { phase: 'empty' }
  | { phase: 'chosen'; file: File; preview: string | null }
  | { phase: 'sending'; file: File; preview: string | null; progress: number }
  /** Did not get through (offline, busy): the same file can go again. */
  | { phase: 'failed'; file: File; preview: string | null; message: string }
  /** Not a file the shop takes: another one is needed. */
  | { phase: 'refused'; code: ReceiptUploadError };

const mb = (bytes: number) => String(Math.round(bytes / (1024 * 1024)));

/** How much of a file name's end a middle cut keeps: a bank app's time and the extension. */
const NAME_TAIL = 12;
let measure: CanvasRenderingContext2D | null | undefined;

/** `name` cut in the middle («Kvitansiya_pe…23-41-07.pdf») to fit `width` px in `font`. */
function middleCut(name: string, width: number, font: string): string {
  measure ??= document.createElement('canvas').getContext('2d');
  const ctx = measure;
  if (!ctx || width <= 0 || name.length <= NAME_TAIL) return name;
  ctx.font = font;
  const fits = (s: string) => ctx.measureText(s).width <= width - 1;
  if (fits(name)) return name;
  const tail = name.slice(-NAME_TAIL);
  let lo = 0;
  let hi = name.length - NAME_TAIL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(`${name.slice(0, mid)}…${tail}`)) lo = mid;
    else hi = mid - 1;
  }
  return `${name.slice(0, lo)}…${tail}`;
}

/**
 * A file name cut in the middle when it does not fit, so its end stays in view: a bank app's
 * «Kvitansiya_perevod_…_23-41-07.pdf» keeps its time and its kind. Measured, so the ellipsis
 * sits right against the end (two CSS-truncated halves leave a gap); until then, and should the
 * measure ever run long, it truncates at the end. Read out whole.
 */
function FileName({ name }: { name: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(name);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const css = getComputedStyle(el);
      setShown(
        middleCut(name, el.clientWidth, `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`),
      );
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [name]);
  return (
    <span ref={box} className="type-row block truncate text-ink">
      <span className="sr-only">{name}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}

/** The file's own picture (an image), or a page for a PDF. */
function FileThumb({ preview }: { preview: string | null }) {
  return (
    <span className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-thumb bg-field text-muted">
      {preview ? (
        <>
          <img src={preview} alt="" className="absolute inset-0 size-full object-cover" />
          {/* a hairline edge, so a white bank screen does not melt into the white card */}
          <span className="absolute inset-0 rounded-thumb shadow-[inset_0_0_0_1px_var(--c-line)]" />
        </>
      ) : (
        <DocIcon size={24} />
      )}
    </span>
  );
}

/**
 * The receipt drop zone (DESIGN.md Payment: a 1.5 px dashed hairline-strong border): what to pick
 * and in which formats; the chosen file with «Заменить»; its progress on the Sage thread while it
 * goes; or why it was not taken.
 */
function ReceiptZone({
  upload,
  maxBytes,
  onPick,
}: {
  upload: Upload;
  maxBytes: number;
  onPick: () => void;
}) {
  const { language } = usePrefs();
  const o = useOrdersText();
  const formats = fill(o.payment.formats, { mb: mb(maxBytes) });
  const frame = 'rounded-card border-[1.5px] border-dashed border-line-strong';

  if (upload.phase === 'empty' || upload.phase === 'refused') {
    const refused = upload.phase === 'refused';
    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={onPick}
          data-testid="receipt-zone"
          className={`${frame} flex w-full items-center gap-3.5 p-4 text-left transition-[background-color,transform] duration-150 ${EASE_OUT} active:scale-[0.99] active:bg-field`}
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-pill bg-block text-ink">
            <UploadIcon size={22} />
          </span>
          <span className="min-w-0">
            <span className="type-row block font-semibold text-ink">{o.payment.choose}</span>
            <span className="type-small mt-0.5 block text-muted">{formats}</span>
          </span>
        </button>
        {refused ? (
          <p
            role="alert"
            data-testid="receipt-refused"
            className="type-small mt-2.5 flex animate-[rise-in_0.22s_cubic-bezier(0.23,1,0.32,1)] items-start gap-2 rounded-btn bg-field px-3 py-2.5 text-ink"
          >
            <span className="shrink-0">
              <AlertIcon size={18} />
            </span>
            <span className="pt-px text-pretty">
              {fill(o.payment.refused[upload.code], { mb: mb(maxBytes) })}
            </span>
          </p>
        ) : null}
      </div>
    );
  }

  const { file, preview } = upload;
  const sending = upload.phase === 'sending';
  const percent = sending ? Math.round(upload.progress * 100) : 0;
  const processing = sending && upload.progress >= 1;
  // the dashed slot is filled: the file sits in a plain card, as in mockup 07
  return (
    <div className="mt-5">
      <div
        className="flex animate-[rise-in_0.22s_cubic-bezier(0.23,1,0.32,1)] items-center gap-3 rounded-card bg-card p-3"
        data-testid="receipt-file"
      >
        <FileThumb preview={preview} />
        <div className="min-w-0 flex-1">
          <FileName name={file.name || o.payment.receipt} />
          {sending ? (
            // the meta line becomes the Sage thread and its count, at the same size
            <div className="animate-[fade-in_0.2s_ease-out]">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={o.payment.send}
                className="mt-2 h-0.5 overflow-hidden rounded-[2px] bg-line"
              >
                <div
                  className={`h-full origin-left rounded-[2px] bg-sage transition-transform duration-200 ${EASE_OUT}`}
                  style={{ transform: `scaleX(${upload.progress})` }}
                />
              </div>
              <p
                className="type-small mt-1.5 text-muted tabular-nums"
                data-testid="upload-progress"
              >
                {processing
                  ? o.payment.processing
                  : fill(o.payment.uploading, { percent: String(percent) })}
              </p>
            </div>
          ) : (
            <p className="type-small mt-0.5 text-muted">
              {formatFileSize(file.size, language)} · {o.payment.ready}
            </p>
          )}
        </div>
        {sending ? null : (
          <button
            type="button"
            onClick={onPick}
            data-testid="receipt-replace"
            className={`type-small -my-3 shrink-0 px-1 py-3 text-ink ${LINK}`}
          >
            {o.payment.replace}
          </button>
        )}
      </div>
      {upload.phase === 'failed' ? (
        <p
          role="alert"
          className="type-small mt-2.5 flex animate-[rise-in_0.22s_cubic-bezier(0.23,1,0.32,1)] items-start gap-2 rounded-btn bg-field px-3 py-2.5 text-ink"
        >
          <span className="shrink-0">
            <AlertIcon size={18} />
          </span>
          <span className="pt-px text-pretty">{upload.message}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * «Ожидает оплаты» (mockup 07): pay until, the amount and the card with copy buttons, the three
 * steps, the receipt upload, the manager and «Отменить заказ». Without a card the note stands in
 * for the first three and the upload stays. The dock picks a file, then sends it; the order then
 * moves to «Чек на проверке» and the screen with it.
 */
function PayStep({ payment }: { payment: PaymentDto }) {
  const o = useOrdersText();
  const qc = useQueryClient();
  const { order, card } = payment;
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<Upload>({ phase: 'empty' });
  const preview = 'preview' in upload ? upload.preview : null;
  // the object URL of a chosen image lives as long as that choice
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const pick = () => input.current?.click();
  const choose = (file: File | undefined) => {
    if (!file) return;
    const refused = precheckReceipt(file, payment.maxUploadBytes);
    if (refused) return setUpload({ phase: 'refused', code: refused });
    const image = /^image\//.test(file.type);
    setUpload({ phase: 'chosen', file, preview: image ? URL.createObjectURL(file) : null });
  };

  const send = async () => {
    if (upload.phase !== 'chosen' && upload.phase !== 'failed') return;
    const { file, preview } = upload;
    setUpload({ phase: 'sending', file, preview, progress: 0 });
    try {
      const out = await uploadReceipt(order.number, file, (progress) =>
        setUpload((u) => (u.phase === 'sending' ? { ...u, progress } : u)),
      );
      if (out.kind === 'uploaded') {
        hapticSuccess();
        await holdPolls(qc, order.number);
        qc.setQueryData<PaymentDto>(paymentKey(order.number), (old) =>
          old
            ? { ...old, order: out.body.order, receipts: [out.body.receipt, ...old.receipts] }
            : old,
        );
        qc.setQueryData(orderKey(order.number), out.body.order);
        void qc.invalidateQueries({ queryKey: [...ORDERS_KEY, 'list'] });
        window.scrollTo({ top: 0 });
      } else if (out.kind === 'refused') {
        setUpload({ phase: 'refused', code: out.code });
      } else if (out.kind === 'try_again') {
        setUpload({ phase: 'failed', file, preview, message: o.payment.tryAgain });
      } else {
        // the order moved on (a receipt from elsewhere, cancelled) or is gone: show it as it is
        void qc.invalidateQueries({ queryKey: paymentKey(order.number) });
        setUpload({ phase: 'empty' });
      }
    } catch (e) {
      if (!(e instanceof UploadNetworkError)) console.error(e);
      setUpload({ phase: 'failed', file, preview, message: o.payment.sendFailed });
    }
  };

  const ready = upload.phase === 'chosen' || upload.phase === 'failed';
  const dock = (
    <Button
      block
      data-testid="pay-action"
      loading={upload.phase === 'sending'}
      onClick={ready || upload.phase === 'sending' ? () => void send() : pick}
    >
      {ready || upload.phase === 'sending' ? (
        <>
          <UploadIcon size={20} />
          {o.payment.send}
        </>
      ) : upload.phase === 'refused' ? (
        o.payment.pickAnother
      ) : (
        o.payment.pick
      )}
    </Button>
  );

  return (
    <Screen tabBar={false} dock={dock}>
      <Head order={order} />
      <LastReceiptNote receipt={payment.receipts[0]} />
      {card ? (
        <>
          <Deadline
            template={o.payment.payUntil}
            until={order.reserveUntil}
            testId="pay-until"
            className="mb-4"
          />
          <TransferCard
            order={order}
            card={card}
            onCopied={(ok) => {
              if (ok) hapticSuccess();
              toast.show(ok ? o.payment.copied : o.payment.copyFailed, ok);
            }}
          />
          <Steps />
        </>
      ) : (
        <>
          <NoCard />
          {/* the reserve keeps running without a card: until when, and the upload for who paid */}
          <Deadline
            template={o.orders.reservedUntil}
            until={order.reserveUntil}
            then={o.payment.alreadyPaid}
            testId="already-paid"
            className="mt-6"
          />
        </>
      )}
      <input
        ref={input}
        type="file"
        accept={RECEIPT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="receipt-input"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <ReceiptZone upload={upload} maxBytes={payment.maxUploadBytes} onPick={pick} />
      <ManagerLine />
      <CancelOrder order={order} spaced={false} />
      {toast.view}
    </Screen>
  );
}

/** The order and what it holds, a tap away from its page (mockups 12, 13). */
function OrderSummary({ order }: { order: OrderDto }) {
  const { language } = usePrefs();
  const o = useOrdersText();
  const router = useRouter();
  const count = order.lines.reduce((n, l) => n + l.qty, 0);
  const photos = order.lines
    .map((l) => l.photo)
    .filter(Boolean)
    .slice(0, 2) as string[];
  return (
    <button
      type="button"
      onClick={() =>
        void router.navigate({ to: '/orders/$number', params: { number: String(order.number) } })
      }
      className={`mt-3 flex w-full items-center gap-3 rounded-card bg-card p-4 text-left text-ink transition-transform duration-150 ${EASE_OUT} active:scale-[0.99]`}
      data-testid="pay-summary"
    >
      <span className="min-w-0 flex-1">
        <span className="type-row block font-semibold text-ink">
          {fill(o.orders.number, { number: String(order.number) })}
        </span>
        <span className="type-small mt-0.5 block text-muted">
          {plural(language, count, o.orders.items)} ·{' '}
          <Money amount={order.total} className="!font-normal !text-[12.5px]" />
        </span>
      </span>
      {photos.map((p, i) => (
        <Thumb key={`${p}-${i}`} photo={p} className="w-11" />
      ))}
    </button>
  );
}

/** The receipt that went in: its name, size and time. */
function SentReceipt({ receipt }: { receipt: ReceiptSummaryDto }) {
  const { language } = usePrefs();
  const o = useOrdersText();
  return (
    <Card className="mt-3 flex items-center gap-3 p-3" data-testid="sent-receipt">
      <span className="grid size-11 shrink-0 place-items-center rounded-thumb bg-field text-muted">
        {receipt.kind === 'pdf' ? <DocIcon size={22} /> : <ImageIcon size={22} />}
      </span>
      <span className="min-w-0 flex-1">
        <FileName name={receipt.fileName ?? o.payment.receipt} />
        <span className="type-small block text-muted">
          {formatFileSize(receipt.size, language)} ·{' '}
          {fill(o.payment.sentAt, { at: formatTime(receipt.createdAt) })}
        </span>
      </span>
    </Card>
  );
}

function AfterDock() {
  const o = useOrdersText();
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <Button
        variant="secondary"
        size="pair"
        className="flex-1"
        onClick={() => void router.navigate({ to: '/orders' })}
      >
        {o.payment.myOrders}
      </Button>
      <Button size="pair" className="flex-1" onClick={() => void router.navigate({ to: '/' })}>
        {o.payment.toShop}
      </Button>
    </div>
  );
}

/** «Чек на проверке» (mockup 12): what happens now, the timeline, the receipt and the order. */
function UnderReview({ payment }: { payment: PaymentDto }) {
  const o = useOrdersText();
  const { order } = payment;
  const latest = payment.receipts[0];
  return (
    <Screen tabBar={false} dock={<AfterDock />}>
      <Head order={order} />
      <div data-testid="under-review">
        <h2 className="font-ui text-[22px] leading-tight font-semibold text-pretty text-ink">
          {o.payment.reviewTitle}
        </h2>
        <p className="type-body mt-2 text-pretty text-muted">{o.payment.reviewText}</p>
      </div>
      <Card className="mt-5 p-4">
        <Timeline status={order.status} createdAt={order.createdAt} />
      </Card>
      {latest ? <SentReceipt receipt={latest} /> : null}
      <OrderSummary order={order} />
      <ManagerLine />
    </Screen>
  );
}

/** Paid (mockup 13): the 64 px Sage disc with a Graphite check, then what comes next. */
function Confirmed({ order }: { order: OrderDto }) {
  const o = useOrdersText();
  return (
    <Screen tabBar={false} dock={<AfterDock />}>
      <Head order={order} />
      <span
        aria-hidden="true"
        className="grid size-16 place-items-center rounded-pill bg-sage text-on-sage"
      >
        <CheckIcon size={28} strokeWidth={1.75} />
      </span>
      <h2 className="mt-5 font-ui text-[22px] leading-tight font-semibold text-pretty text-ink">
        {o.payment.doneTitle}
      </h2>
      <p className="type-body mt-2 text-pretty text-muted">
        {fill(o.payment.doneText, { number: String(order.number) })}
      </p>
      <Card className="mt-5 p-4">
        <Timeline status={order.status} createdAt={order.createdAt} />
      </Card>
      <OrderSummary order={order} />
      <ManagerLine />
    </Screen>
  );
}

function Loading() {
  const o = useOrdersText();
  return (
    <Screen tabBar={false}>
      <ScreenHeader title={o.payment.title} />
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-[236px] w-full" rounded="card" />
        <Skeleton className="h-[120px] w-full" />
      </div>
    </Screen>
  );
}

/** Another status (cancelled, handed to BTS, delivered): the order page says it better. */
function ToOrder({ number }: { number: number }) {
  const router = useRouter();
  useEffect(() => {
    void router.navigate({
      to: '/orders/$number',
      params: { number: String(number) },
      replace: true,
    });
  }, [router, number]);
  return <Loading />;
}

/** The payment screen of one order (spec Changes 2026-11-07 payment details, #28). */
export function Payment() {
  const o = useOrdersText();
  const router = useRouter();
  const { number } = useParams({ from: '/orders/$number/pay' });
  const query = usePayment(Number(number));

  if (query.isError && query.data === undefined)
    return (
      <Screen tabBar={false}>
        <ScreenHeader title={o.payment.title} />
        <ErrorState fill retrying={query.isFetching} onRetry={() => void query.refetch()} />
      </Screen>
    );
  if (query.data === undefined) return <Loading />;
  if (query.data === null)
    return (
      <Screen tabBar={false}>
        <ScreenHeader title={o.payment.title} />
        <EmptyState
          fill
          icon={<BoxIcon size={28} />}
          title={o.orders.notFoundTitle}
          text={o.orders.notFoundText}
          action={
            <Button block onClick={() => void router.navigate({ to: '/orders' })}>
              {o.orders.toOrders}
            </Button>
          }
        />
      </Screen>
    );
  return <PaymentView payment={query.data} />;
}

export function PaymentView({ payment }: { payment: PaymentDto }): ReactNode {
  const { order } = payment;
  if (order.status === 'awaiting_payment') return <PayStep payment={payment} />;
  if (order.status === 'receipt_review') return <UnderReview payment={payment} />;
  if (PAID_ON_THE_WAY.has(order.status)) return <Confirmed order={order} />;
  return <ToOrder number={order.number} />;
}
