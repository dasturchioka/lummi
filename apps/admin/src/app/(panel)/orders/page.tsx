import {
  ADMIN_ORDERS_PAGE_SIZE,
  adminOrdersBoardQuerySchema,
  adminOrdersQuerySchema,
} from '@lummi/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OrdersExportButton } from '@/components/orders/export-button';
import { OrdersBoard } from '@/components/orders/board/orders-board';
import { BoardFilters } from '@/components/orders/board/board-filters';
import { OrdersList } from '@/components/orders/orders-list';
import { ViewSwitch } from '@/components/orders/view-switch';
import { PageHeader } from '@/components/page-header';
import { getAdminMessages } from '@/lib/i18n';
import { ordersView } from '@/lib/orders-view';
import { clampPage, readFilters, readPage, type Search } from '@/lib/list-page';
import { getMe, serverApi } from '@/lib/server-api';
import { TEXT_LINK } from '@/lib/ui-classes';

const LIST_KEYS = ['q', 'status', 'payment', 'from', 'to', 'paidOn'] as const;
const BOARD_KEYS = ['q', 'payment', 'from', 'to'] as const;

/**
 * «Заказы» (#33, #52, #56): the board («Воронка») by default, the list behind `?view=list`. A link that
 * names a status (the Home's queues, an old bookmark) opens the list: on the board the status is
 * the column. The header's actions are shared by both views (the owner also gets «Скачать в Excel»).
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const view = ordersView(sp);
  const { language, t } = await getAdminMessages();
  const o = t.orders;
  // the file holds personal data: its button is the owner's (the API refuses a manager anyway)
  const me = await getMe();
  const isOwner = me.status === 200 && me.body.role === 'owner';

  // one header for both views, so «Воронка | Список» stays put when switching: the title and
  // the actions slot, no description (the board needs the height)
  const header = (filters: Record<string, string | undefined>) => (
    <PageHeader
      title={o.title}
      actions={
        // the header's actions slot, the same in both views (#56 adds «Скачать в Excel» here)
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-orders-actions>
          <ViewSwitch view={view} filters={filters} t={t} />
          {isOwner && <OrdersExportButton filters={filters} language={language} t={t} />}
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
      // both views take the panel's whole width and its 24 px sides (globals.css)
      <div data-layout="wide">
        {header(filters)}
        <BoardFilters t={t} filters={filters} />
        <OrdersBoard key={JSON.stringify(filters)} t={t} language={language} filters={filters} />
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
    <div data-layout="wide">
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
    </div>
  );
}
