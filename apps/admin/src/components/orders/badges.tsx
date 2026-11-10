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

/** Where the money stands; a receipt waiting for a person breathes, a confirmed payment is sage. */
export function PaymentBadge({ payment, t }: { payment: PaymentState; t: AdminMessages }) {
  const tone = payment === 'paid' ? 'sage' : payment === 'manual_review' ? 'live' : 'neutral';
  return <Badge tone={tone}>{t.orders.payment[payment]}</Badge>;
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
