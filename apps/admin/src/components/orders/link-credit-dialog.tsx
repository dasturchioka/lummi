'use client';

import {
  charCount,
  ORDER_NUMBER_MAX,
  WAITING_RECEIPT_VERDICTS,
  type AdminCreditDto,
  type AdminOrderDto,
} from '@lummi/contracts';
import { formatMoney, formatTiyin, type Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import { useState, type FormEvent } from 'react';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';
import { formatTashkent } from '@/lib/setting-copy';
import { Frame, LinkReasonField, Mark, ReferenceLine, reasonFits } from './order-dialogs';

/**
 * «Привязать к заказу» from the credits list: find the order by its number, then confirm its
 * payment with this credit through the same door as the order page (#32's `PaymentConfirmation`,
 * the manager as actor): with the receipt under check, or none while the order waits for payment.
 * A credit of another amount or card asks for a reason.
 */
export function LinkCreditDialog({
  credit,
  t,
  language,
  onOpenChange,
  onLinked,
}: {
  credit: AdminCreditDto;
  t: AdminMessages;
  language: Language;
  onOpenChange: (open: boolean) => void;
  onLinked: (number: number) => void;
}) {
  const c = t.credits;
  const o = t.orders;
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState<AdminOrderDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [finding, setFinding] = useState(false);
  const [reason, setReason] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = (s: AdminOrderDto['order']['status']) =>
    ordersMessages[language].orders.status[s];
  const waiting =
    page && (page.order.status === 'awaiting_payment' || page.order.status === 'receipt_review');
  // the receipt under check is the order's latest; none while the order waits for payment
  const receipt =
    page?.order.status === 'receipt_review'
      ? (page.receipts.find((r) => WAITING_RECEIPT_VERDICTS.includes(r.verdict)) ?? null)
      : null;
  const otherAmount = page !== null && credit.amountSom !== page.order.amountDue;
  const differs = page !== null && (otherAmount || !credit.onShopCard || mismatch);
  // what a press will link, said above the buttons when the credit does not fit the order
  const summary =
    page && waiting && differs
      ? [
          otherAmount &&
            fill(o.sumAmount, {
              credit: formatTiyin(credit.amountTiyin, language),
              due: formatMoney(page.order.amountDue, language),
            }),
          !credit.onShopCard && fill(o.sumCard, { last4: credit.cardLast4 }),
        ]
          .filter(Boolean)
          .join('. ')
      : null;

  const find = async () => {
    const number = Number(typed.replace(/\D/g, ''));
    setError(null);
    setMissing(false);
    setPage(null);
    setMismatch(false);
    if (!Number.isSafeInteger(number) || number <= 0 || number > ORDER_NUMBER_MAX) {
      setMissing(true);
      return;
    }
    setFinding(true);
    const res = await browserApi.orders.get({ params: { number } }).catch(() => null);
    setFinding(false);
    if (res?.status === 200) setPage(res.body);
    else if (res?.status === 404) setMissing(true);
    else setError(t.errors.generic);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!page) return void find();
    setTried(true);
    setError(null);
    if (!waiting || (differs && !reasonFits(reason, page.limits))) return;
    setBusy(true);
    const res = await browserApi.orders
      .confirmPayment({
        params: { number: page.order.number },
        body: {
          creditId: credit.id,
          receiptId: receipt?.id ?? null,
          ...(differs ? { reason: reason.trim() } : {}),
        },
      })
      .catch(() => null);
    setBusy(false);
    if (res?.status === 200) return onLinked(page.order.number);
    if (res?.status === 409 && 'order' in res.body) {
      setPage(res.body.order);
      setError(
        res.body.code === 'credit_taken'
          ? o.creditTaken
          : fill(o.conflict, { status: statusLabel(res.body.order.order.status) }),
      );
    } else if (res?.status === 422 && res.body.code === 'reason_required') {
      setMismatch(true);
      setTried(false);
    } else if (res?.status === 422 && res.body.code === 'reason_invalid') {
      setError(
        charCount(reason.trim()) < (res.body.min ?? 0)
          ? fill(o.linkReasonShort, { min: String(res.body.min ?? '') })
          : fill(o.linkReasonLong, { max: String(res.body.max ?? '') }),
      );
    } else if (res?.status === 422 && res.body.code === 'credit_mismatch') {
      setError(res.body.what === 'before_order' ? o.beforeOrder : o.notAllowed);
    } else if (res?.status === 422) setError(o.notAllowed);
    else setError(res?.status === 409 ? o.tryAgain : t.errors.generic);
  };

  return (
    <Frame
      open
      onOpenChange={onOpenChange}
      title={c.linkTitle}
      description={c.linkText}
      onSubmit={submit}
      error={error}
      busy={busy || finding}
      submit={page ? o.detail.confirm : c.find}
      cancel={t.actions.cancel}
      summary={summary ? <Mark>{summary}</Mark> : undefined}
    >
      <div className="-mt-1 grid gap-1">
        <p className="font-semibold tabular-nums">
          {fill(c.thisCredit, { amount: formatTiyin(credit.amountTiyin, language) })}
        </p>
        <p className="text-small text-muted-foreground tabular-nums">
          {formatTashkent(credit.occurredAt)} · {fill(o.cardShort, { last4: credit.cardLast4 })}
        </p>
      </div>
      {/* the dialog's own button reads «Найти» until the order is found */}
      <Field id="link-order" label={c.orderNumber} error={missing ? c.notFound : undefined}>
        <Input
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setPage(null);
            setMissing(false);
          }}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="search"
          className="tabular-nums"
        />
      </Field>
      {page && (
        <div className="grid gap-2" data-link-order>
          <p className="font-semibold [overflow-wrap:anywhere]">
            {fill(c.orderFound, {
              number: String(page.order.number),
              customer: page.customer.name,
            })}
          </p>
          <ReferenceLine page={page} t={t} language={language} />
          {otherAmount && <Mark>{o.amountDiffers}</Mark>}
          {!credit.onShopCard && <Mark>{fill(o.markCard, { last4: credit.cardLast4 })}</Mark>}
          <p className="text-small text-muted-foreground">
            {receipt ? c.withReceipt : c.withoutReceipt}
          </p>
        </div>
      )}
      {page && !waiting && (
        <Notice
          title={fill(c.notWaiting, {
            number: String(page.order.number),
            status: statusLabel(page.order.status),
          })}
        />
      )}
      {page && waiting && differs && (
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
