import { ADMIN_ORDERS_PAGE_SIZE, adminOrdersQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { OrdersList, type OrderFilters } from '@/components/orders/orders-list';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const KEYS = ['q', 'status', 'payment', 'from', 'to'] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  // whatever the URL holds, only what the contract accepts reaches the API; the rest is dropped
  const filters: OrderFilters = {};
  for (const key of KEYS) {
    const value = one(sp[key])?.trim();
    if (value && adminOrdersQuerySchema.shape[key].safeParse(value).success) filters[key] = value;
  }
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? '1', 10) || 1);

  const api = await serverApi();
  const query = adminOrdersQuerySchema.parse({
    ...filters,
    page,
    pageSize: ADMIN_ORDERS_PAGE_SIZE,
  });
  const list = await api.orders.list({ query });
  if (list.status === 401) redirect('/login');
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (list.status !== 200) throw new Error(`orders failed to load: ${list.status}`);
  // a page past the end (an old link, fewer orders after a filter) opens the last one
  const last = Math.max(1, Math.ceil(list.body.total / list.body.pageSize));
  if (page > last) {
    const q = new URLSearchParams(filters);
    if (last > 1) q.set('page', String(last));
    redirect(q.size ? `/orders?${q}` : '/orders');
  }
  const { language, t } = await getAdminMessages();
  return (
    <OrdersList
      t={t}
      language={language}
      items={list.body.items}
      total={list.body.total}
      page={list.body.page}
      pageSize={list.body.pageSize}
      filters={filters}
    />
  );
}
