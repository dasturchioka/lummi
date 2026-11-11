import { ADMIN_ORDERS_PAGE_SIZE, adminCreditsQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { CreditsList } from '@/components/orders/credits-list';
import { getAdminMessages } from '@/lib/i18n';
import { clampPage, readFilters, readPage, type Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';

const KEYS = ['linked', 'amount', 'from', 'to'] as const;

export default async function CreditsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  // «149 000» is how people type an amount
  const filters = readFilters(sp, adminCreditsQuerySchema.shape, KEYS, {
    amount: (v) => v.replace(/\s/g, ''),
  });
  if (filters.linked === 'all') delete filters.linked;
  const page = readPage(sp);

  const api = await serverApi();
  const query = adminCreditsQuerySchema.parse({
    ...filters,
    page,
    pageSize: ADMIN_ORDERS_PAGE_SIZE,
  });
  const list = await api.credits.list({ query });
  if (list.status === 401) redirect('/login');
  if (list.status !== 200) throw new Error(`credits failed to load: ${list.status}`);
  clampPage('/credits', filters, page, list.body.total, list.body.pageSize);
  const { language, t } = await getAdminMessages();
  return (
    <CreditsList
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
