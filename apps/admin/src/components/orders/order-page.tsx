'use client';

import {
  FULFIL_ACTIONS,
  findTransition,
  type AdminOrderDto,
  type AdminReceiptDto,
  type FulfilAction,
} from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';
import { PaymentBadge, StatusBadge } from './badges';
import {
  CancelDialog,
  ConfirmPaymentDialog,
  HandToBtsDialog,
  RejectDialog,
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

/** Staff may make this move from that status (the contracts' table, ADR 0011). */
const staffMay = (status: AdminOrderDto['order']['status'], action: FulfilAction | 'cancel') =>
  findTransition(status, action)?.actors.includes('staff') ?? false;

type Dialog =
  | { kind: 'reject'; receipt: AdminReceiptDto; key: number }
  | { kind: 'confirm'; receiptId: number | null; key: number }
  | { kind: 'cancel'; key: number }
  | { kind: 'hand'; key: number }
  | null;

/** What every move answers: the order page now, or why not. */
type MoveResponse = Awaited<ReturnType<typeof browserApi.orders.fulfil>>;

/**
 * The order page (#33): what the order waits for and the one next step, the receipts with their
 * verdicts, the lines and totals, who and where, the history and the audit. Every move answers
 * with the page as it is now, so a second manager's press (409) shows the order as it moved on.
 */
export function OrderPage({
  initial,
  t,
  language,
}: {
  initial: AdminOrderDto;
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
  const statusLabel = (s: typeof status) => ordersMessages[language].orders.status[s];

  /** Applies a move's answer; returns what failed for the dialog, or null when it is done. */
  const apply = (res: MoveResponse | null): Failure | null => {
    if (!res) return { text: t.errors.generic };
    switch (res.status) {
      case 200:
        setPage(res.body);
        setNotice(null);
        setDialog(null);
        return null;
      case 409:
        if (res.body.code === 'try_again') return { text: o.tryAgain };
        setPage(res.body.order);
        setDialog(null);
        setNotice(
          res.body.code === 'receipt_changed'
            ? o.receiptChanged
            : res.body.code === 'credit_taken'
              ? o.creditTaken
              : fill(o.conflict, { status: statusLabel(res.body.order.order.status) }),
        );
        return null;
      case 422:
        switch (res.body.code) {
          case 'note_too_long':
            return { text: fill(o.rejectNoteTooLong, { max: String(res.body.max ?? '') }) };
          case 'reason_required':
            return { text: o.linkReasonRequired, mismatch: res.body.mismatch ?? [] };
          case 'reason_invalid':
            return {
              text: fill(o.linkReasonLong, { max: String(res.body.max ?? '') }),
              mismatch: [],
            };
          default:
            return { text: o.notAllowed };
        }
      case 401:
        router.push('/login');
        return null;
      default:
        return { text: t.errors.generic };
    }
  };
  const number = page.order.number;
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
  const canCancel = staffMay(status, 'cancel');

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
              <PaymentBadge payment={page.payment} t={t} />
            </div>
            {cancellation ? (
              <div className="grid gap-1 text-sm">
                <p className="font-medium">{o.cancelReasons[cancellation.reason]}</p>
                <p className="text-small text-muted-foreground tabular-nums">
                  {fill(o.cancelledAt, { at: formatTashkent(cancellation.at) })}
                </p>
                {cancellation.afterPayment && <p className="mt-1">{o.refundDue}</p>}
              </div>
            ) : (
              hint && <p className="text-sm text-pretty text-muted-foreground">{hint}</p>
            )}
            {notice && <Notice title={notice} />}
            {(next || canCancel || status === 'awaiting_payment') && (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {next && (
                  <Button onClick={() => void step(next)} loading={busy === next} data-next={next}>
                    {o.step[next]}
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
                {canCancel && (
                  <Button
                    variant="outline"
                    onClick={() => setDialog({ kind: 'cancel', key: Date.now() })}
                    disabled={busy !== null}
                  >
                    {o.step.cancel}
                  </Button>
                )}
              </div>
            )}
          </Card>
          <ReceiptsSection
            page={page}
            t={t}
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
          <CommentSection page={page} t={t} language={language} />
          <GiftSection page={page} t={t} language={language} />
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
            apply(await browserApi.orders.confirmPayment({ params, body }).catch(() => null))
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
