'use client';

import { OrderReviewSection } from '@/components/reviews/order-review';
import {
  FULFIL_ACTIONS,
  staffMay,
  type AdminOrderCostsDto,
  type AdminOrderDto,
  type AdminReceiptDto,
  type FulfilAction,
} from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent } from '@/lib/setting-copy';
import { QUIET_ACTION } from '@/lib/ui-classes';
import { useVisiblePoll } from '@/lib/use-visible-poll';
import { fill } from '@/lib/utils';
import { PaymentBadge, paymentWorthShowing, RefundBadge, StatusBadge } from './badges';
import {
  CancelDialog,
  conflictText,
  ConfirmPaymentDialog,
  HandToBtsDialog,
  RefundDialog,
  RejectDialog,
  refusalFailure,
  ReturnDialog,
  type Failure,
} from './order-dialogs';
import {
  AuditSection,
  CustomerSection,
  DeliverySection,
  HistorySection,
  CommentSection,
  GiftSection,
  LinesSection,
  PaymentSection,
  ReceiptsSection,
} from './order-sections';
import { OrderProfitSection } from './order-profit';

type Dialog =
  | { kind: 'reject'; receipt: AdminReceiptDto; key: number }
  | { kind: 'confirm'; receiptId: number | null; key: number }
  | { kind: 'cancel'; key: number }
  | { kind: 'hand'; key: number }
  | { kind: 'refund'; key: number }
  | { kind: 'return'; key: number }
  | null;

/**
 * What a paid order that ended still owes its shopper (#40): «верните N», then what went back and
 * what is left, until the Refunds cover it. Nothing for an order that is not ended or not paid.
 */
function OwedLine({
  page,
  t,
  language,
}: {
  page: AdminOrderDto;
  t: AdminMessages;
  language: Language;
}) {
  const m = page.money;
  const money = (n: number) => formatMoney(n, language);
  const ended = page.order.status === 'cancelled' || page.order.status === 'returned';
  if (!ended || m.paid === null) return null;
  const text =
    m.owed === 0
      ? m.refunded > 0
        ? fill(t.orders.money.settled, { amount: money(m.refunded) })
        : null
      : m.refunded > 0
        ? fill(t.orders.money.partlyOwed, { refunded: money(m.refunded), owed: money(m.owed) })
        : fill(t.orders.money.owed, { amount: money(m.owed) });
  if (!text) return null;
  return (
    <p className="mt-1 font-medium tabular-nums" data-owed={m.owed}>
      {text}
    </p>
  );
}

/** What every move answers: the order page now, or why not. */
type MoveResponse = Awaited<ReturnType<typeof browserApi.orders.fulfil>>;

/**
 * The order page (#33): what the order waits for and the one next step, the receipts with their
 * verdicts, the lines and totals, who and where, the history and the audit. Every move answers
 * with the page as it is now, so a second manager's press (409) shows the order as it moved on.
 */
export function OrderPage({
  initial,
  costs,
  t,
  language,
}: {
  initial: AdminOrderDto;
  /** The order's profit (#77): the owner's only; null on a manager's page. */
  costs?: AdminOrderCostsDto | null;
  t: AdminMessages;
  language: Language;
}) {
  const o = t.orders;
  const d = o.detail;
  const router = useRouter();
  const [page, setPage] = useState(initial);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<FulfilAction | null>(null);
  const status = page.order.status;
  const number = page.order.number;
  /** Counts the page's own writes: a poll that began before one never overwrites it. */
  const writes = useRef(0);
  const idle = useRef(true);
  useEffect(() => {
    idle.current = dialog === null && busy === null;
  });
  // live: another manager's or the bot's move shows here within ~10 s and on return to the tab
  useVisiblePoll(async (signal) => {
    if (!idle.current) return;
    const seen = writes.current;
    const res = await browserApi.orders.get({ params: { number }, fetchOptions: { signal } });
    if (signal.aborted || seen !== writes.current || !idle.current) return;
    if (res.status === 401) return router.replace('/login');
    if (res.status !== 200) return;
    setPage((was) => (JSON.stringify(was) === JSON.stringify(res.body) ? was : res.body));
  });

  /** Applies a move's answer; returns what failed for the dialog, or null when it is done. */
  const apply = (res: MoveResponse | null, reason?: string): Failure | null => {
    if (!res) return { text: t.errors.generic };
    switch (res.status) {
      case 200:
        writes.current += 1;
        setPage(res.body);
        setNotice(null);
        setDialog(null);
        return null;
      case 409:
        if (res.body.code === 'try_again') return { text: o.tryAgain };
        writes.current += 1;
        setPage(res.body.order);
        setDialog(null);
        setNotice(conflictText(res.body, t, language));
        return null;
      case 422:
        return refusalFailure(res.body, t, language, reason);
      case 401:
        router.push('/login');
        return null;
      default:
        return { text: t.errors.generic };
    }
  };
  const params = { number };

  const next = FULFIL_ACTIONS.find((a) => staffMay(status, a)) ?? null;
  const step = async (action: FulfilAction) => {
    if (action === 'hand_to_bts') {
      setDialog({ kind: 'hand', key: Date.now() });
      return;
    }
    setBusy(action);
    const res = await browserApi.orders
      .fulfil({ params, body: { action, expectedStatus: status } })
      .catch(() => null);
    setBusy(null);
    const failed = apply(res);
    if (failed) setNotice(failed.text);
  };

  const manual = page.payment === 'manual_review';
  const hint =
    status === 'receipt_review'
      ? o.stepHint[manual ? 'manual_review' : 'receipt_review']
      : status in o.stepHint
        ? o.stepHint[status as keyof typeof o.stepHint]
        : null;
  const cancellation = page.order.cancellation;
  const returned = page.returned;
  const canCancel = staffMay(status, 'cancel');
  const canReturn = staffMay(status, 'return') && page.returnPreview !== null;
  const money = page.money;
  const canRefund = money.paid !== null && money.refundable > 0;
  // an order that ended paid waits for its money to go back: then the refund is the next step
  const refundIsNext = canRefund && money.owed > 0;
  const openRefund = () => setDialog({ kind: 'refund', key: Date.now() });

  return (
    <>
      <PageHeader
        title={fill(d.title, { number: String(number) })}
        description={fill(d.created, { at: formatTashkent(page.order.createdAt) })}
        actions={
          <Button variant="outline" asChild>
            <Link href="/orders">
              <ArrowLeft strokeWidth={1.5} aria-hidden />
              {d.back}
            </Link>
          </Button>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid min-w-0 gap-4">
          <Card className="grid gap-4 p-4 sm:p-6" data-status>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={status} language={language} />
              {paymentWorthShowing(status, page.payment) && (
                <PaymentBadge payment={page.payment} t={t} />
              )}
              {money.refunded > 0 && (
                <RefundBadge amount={money.refunded} t={t} language={language} />
              )}
            </div>
            {cancellation ? (
              <div className="grid gap-1 text-sm">
                <p className="font-medium">{o.cancelReasons[cancellation.reason]}</p>
                <p className="text-small text-muted-foreground tabular-nums">
                  {fill(o.cancelledAt, { at: formatTashkent(cancellation.at) })}
                </p>
                <OwedLine page={page} t={t} language={language} />
              </div>
            ) : returned ? (
              <div className="grid gap-1 text-sm" data-returned>
                <p className="font-medium text-pretty [overflow-wrap:anywhere]">
                  {returned.reason}
                </p>
                <p className="text-small text-muted-foreground tabular-nums">
                  {fill(o.ret.returnedBy, {
                    at: formatTashkent(returned.at),
                    name: returned.by.name ?? d.actor.removed,
                  })}
                </p>
                <OwedLine page={page} t={t} language={language} />
              </div>
            ) : (
              hint && <p className="text-sm text-pretty text-muted-foreground">{hint}</p>
            )}
            {notice && <Notice title={notice} />}
            {(next || status === 'awaiting_payment' || refundIsNext) && (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {next && (
                  <Button onClick={() => void step(next)} loading={busy === next} data-next={next}>
                    {o.step[next]}
                  </Button>
                )}
                {refundIsNext && (
                  <Button onClick={openRefund} data-refund>
                    {o.refund.action}
                  </Button>
                )}
                {/* a credit that came with no receipt (TZ §4): money on the card is what counts */}
                {status === 'awaiting_payment' && (
                  <Button
                    onClick={() => setDialog({ kind: 'confirm', receiptId: null, key: Date.now() })}
                    data-confirm-payment
                  >
                    {d.confirm}
                  </Button>
                )}
              </div>
            )}
            {/* cancelling, returning and refunding are never beside the routine step: quiet
                actions under a hairline */}
            {(canCancel || canReturn || (canRefund && !refundIsNext)) && (
              <div className="-mx-4 -mb-1 border-t border-border px-4 pt-2 sm:-mx-6 sm:px-6">
                {/* the first label lines up with the card's text; each keeps its own tap area */}
                <div className="-ml-3 flex flex-wrap gap-x-1">
                  {canReturn && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={QUIET_ACTION}
                      onClick={() => setDialog({ kind: 'return', key: Date.now() })}
                      disabled={busy !== null}
                      data-return
                    >
                      {o.ret.action}
                    </Button>
                  )}
                  {canRefund && !refundIsNext && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={QUIET_ACTION}
                      onClick={openRefund}
                      disabled={busy !== null}
                      data-refund
                    >
                      {o.refund.action}
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={QUIET_ACTION}
                      onClick={() => setDialog({ kind: 'cancel', key: Date.now() })}
                      disabled={busy !== null}
                      data-cancel
                    >
                      {o.step.cancel}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Card>
          <ReceiptsSection
            page={page}
            t={t}
            language={language}
            onReject={(receipt) => setDialog({ kind: 'reject', receipt, key: Date.now() })}
            onConfirm={(receipt) =>
              setDialog({ kind: 'confirm', receiptId: receipt.id, key: Date.now() })
            }
          />
          <LinesSection page={page} t={t} language={language} />
        </div>
        <div className="grid min-w-0 gap-4">
          <CustomerSection page={page} t={t} language={language} />
          <DeliverySection page={page} t={t} language={language} />
          <PaymentSection page={page} t={t} language={language} />
          {costs && <OrderProfitSection page={page} initial={costs} t={t} language={language} />}
          <CommentSection page={page} t={t} language={language} />
          <GiftSection page={page} t={t} language={language} />
          <OrderReviewSection review={page.review} t={t} />
        </div>
      </div>
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <HistorySection page={page} t={t} language={language} />
        <AuditSection page={page} t={t} language={language} />
      </div>

      {dialog?.kind === 'reject' && (
        <RejectDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          page={page}
          receiptId={dialog.receipt.id}
          t={t}
          onSubmit={async (body) =>
            apply(await browserApi.orders.rejectReceipt({ params, body }).catch(() => null))
          }
        />
      )}
      {dialog?.kind === 'confirm' && (
        <ConfirmPaymentDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          page={page}
          receiptId={dialog.receiptId}
          t={t}
          language={language}
          onSubmit={async (body) =>
            apply(
              await browserApi.orders.confirmPayment({ params, body }).catch(() => null),
              body.reason,
            )
          }
        />
      )}
      {dialog?.kind === 'cancel' && (
        <CancelDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          page={page}
          t={t}
          onSubmit={async (body) =>
            apply(
              await browserApi.orders
                .cancel({ params, body: { ...body, expectedStatus: status } })
                .catch(() => null),
            )
          }
        />
      )}
      {dialog?.kind === 'refund' && (
        <RefundDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          page={page}
          t={t}
          language={language}
          onSubmit={async (body) =>
            apply(
              await browserApi.orders
                .refund({ params, body: { ...body, expectedRefunded: money.refunded } })
                .catch(() => null),
            )
          }
        />
      )}
      {dialog?.kind === 'return' && (
        <ReturnDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          page={page}
          t={t}
          language={language}
          onSubmit={async (body) =>
            apply(
              await browserApi.orders
                .return({ params, body: { ...body, expectedStatus: status } })
                .catch(() => null),
            )
          }
        />
      )}
      {dialog?.kind === 'hand' && (
        <HandToBtsDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          page={page}
          t={t}
          onSubmit={async ({ trackingNumber }) =>
            apply(
              await browserApi.orders
                .fulfil({
                  params,
                  body: { action: 'hand_to_bts', expectedStatus: status, trackingNumber },
                })
                .catch(() => null),
            )
          }
        />
      )}
    </>
  );
}
