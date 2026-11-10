import type { OrderStatus, PaymentState, ReceiptVerdict } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import { Badge } from '@/components/ui/badge';
import type { AdminMessages } from '@/lib/i18n';

/** The order's status as the shopper reads it; delivered is sage, a receipt under check is live. */
export function StatusBadge({ status, language }: { status: OrderStatus; language: Language }) {
  const tone = status === 'delivered' ? 'sage' : status === 'receipt_review' ? 'live' : 'neutral';
  return <Badge tone={tone}>{ordersMessages[language].orders.status[status]}</Badge>;
}

/**
 * The payment state says something the status does not only when a receipt waits for a person,
 * or an order ended unpaid or paid (a cancel then owes a Refund). Otherwise its chip would repeat
 * the status («Чек на проверке» and «на проверке»), so it is left out: one chip per meaning.
 */
export const paymentWorthShowing = (status: OrderStatus, payment: PaymentState) =>
  payment === 'manual_review' || (status === 'cancelled' && payment === 'paid');

/** Where the money stands, in its own words; a receipt waiting for a person breathes. */
export function PaymentBadge({ payment, t }: { payment: PaymentState; t: AdminMessages }) {
  const tone = payment === 'paid' ? 'sage' : payment === 'manual_review' ? 'live' : 'neutral';
  return <Badge tone={tone}>{t.orders.paymentChip[payment]}</Badge>;
}

/** A receipt's verdict: confirmed is sage, one waiting for a person breathes. */
export function VerdictBadge({ verdict, t }: { verdict: ReceiptVerdict; t: AdminMessages }) {
  const tone =
    verdict === 'ai_confirmed' || verdict === 'manager_confirmed'
      ? 'sage'
      : verdict === 'manual_review'
        ? 'live'
        : 'neutral';
  return <Badge tone={tone}>{t.orders.detail.verdict[verdict]}</Badge>;
}
