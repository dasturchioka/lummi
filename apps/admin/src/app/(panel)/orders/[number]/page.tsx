import { notFound, redirect } from 'next/navigation';
import { OrderPage } from '@/components/orders/order-page';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function OrderNumberPage({ params }: { params: Promise<{ number: string }> }) {
  const number = Number((await params).number);
  if (!Number.isInteger(number) || number <= 0) notFound();
  const api = await serverApi();
  // the order's profit is the owner's (#77): a manager's 403 leaves it out
  const [res, costs] = await Promise.all([
    api.orders.get({ params: { number } }),
    api.orders.costs({ params: { number } }),
  ]);
  if (res.status === 401) redirect('/login');
  if (res.status === 404) notFound();
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (res.status !== 200) throw new Error(`order ${number} failed to load: ${res.status}`);
  const { t, language } = await getAdminMessages();
  return (
    <OrderPage
      key={number}
      initial={res.body}
      costs={costs.status === 200 ? costs.body : null}
      language={language}
      t={t}
    />
  );
}
