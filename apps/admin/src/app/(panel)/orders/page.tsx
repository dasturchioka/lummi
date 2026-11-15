import {
  ADMIN_ORDERS_PAGE_SIZE,
  adminOrdersBoardQuerySchema,
  adminOrdersQuerySchema,
} from '@lummi/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OrdersBoard } from '@/components/orders/board/orders-board';
import { OrdersFiltersForm } from '@/components/orders/orders-filters';
import { OrdersList } from '@/components/orders/orders-list';
import { ViewSwitch, type OrdersView } from '@/components/orders/view-switch';
import { PageHeader } from '@/components/page-header';
import { getAdminMessages } from '@/lib/i18n';
import { clampPage, readFilters, readPage, type Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';
import { TEXT_LINK } from '@/lib/ui-classes';

const LIST_KEYS = ['q', 'status', 'payment', 'from', 'to'] as const;
const BOARD_KEYS = ['q', 'payment', 'from', 'to'] as const;

/**
 * «Заказы» (#33, #52): the board («Воронка») by default, the list behind `?view=list`. A link that
 * names a status (the Home's queues, an old bookmark) opens the list: on the board the status is
 * the column. The header's actions are shared by both views (#56 adds «Скачать в Excel» there).
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const asked = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: OrdersView =
    asked === 'list' || (asked !== 'board' && sp.status !== undefined) ? 'list' : 'board';
  const { language, t } = await getAdminMessages();
  const o = t.orders;

  const header = (filters: Record<string, string | undefined>) => (
    <PageHeader
      title={o.title}
      description={o.description}
      actions={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ViewSwitch view={view} filters={filters} t={t} />
          <Link href="/credits" className={TEXT_LINK}>
            {o.toCredits}
          </Link>
        </div>
      }
    />
  );

  if (view === 'board') {
    const filters = readFilters(sp, adminOrdersBoardQuerySchema.shape, BOARD_KEYS);
    return (
      // the board takes the panel's whole width (globals.css drops the 1120 px cap)
      <div data-layout="wide">
        {header(filters)}
        <OrdersFiltersForm t={t} language={language} filters={filters} view="board" />
        <OrdersBoard t={t} language={language} filters={filters} />
      </div>
    );
  }

  const filters = readFilters(sp, adminOrdersQuerySchema.shape, LIST_KEYS);
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
  clampPage('/orders', { view: 'list', ...filters }, page, list.body.total, list.body.pageSize);
  return (
    <>
      {header(filters)}
      <OrdersList
        t={t}
        language={language}
        items={list.body.items}
        total={list.body.total}
        page={list.body.page}
        pageSize={list.body.pageSize}
        filters={filters}
      />
    </>
  );
}
