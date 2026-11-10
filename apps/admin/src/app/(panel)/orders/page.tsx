import { ADMIN_ORDERS_PAGE_SIZE, adminOrdersQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { OrdersList } from '@/components/orders/orders-list';
import { getAdminMessages } from '@/lib/i18n';
import { clampPage, readFilters, readPage, type Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';

const KEYS = ['q', 'status', 'payment', 'from', 'to'] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filters = readFilters(sp, adminOrdersQuerySchema.shape, KEYS);
  const page = readPage(sp);

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
  clampPage('/orders', filters, page, list.body.total, list.body.pageSize);
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
