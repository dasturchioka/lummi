import { ADMIN_ORDERS_PAGE_SIZE, adminCreditsQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { CreditsList, type CreditFilters } from '@/components/orders/credits-list';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const KEYS = ['linked', 'amount', 'from', 'to'] as const;

export default async function CreditsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  // whatever the URL holds, only what the contract accepts reaches the API; the rest is dropped
  const filters: CreditFilters = {};
  for (const key of KEYS) {
    const value = one(sp[key])
      ?.trim()
      .replace(/\s/g, key === 'amount' ? '' : ' ');
    if (value && adminCreditsQuerySchema.shape[key].safeParse(value).success) filters[key] = value;
  }
  if (filters.linked === 'all') delete filters.linked;
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? '1', 10) || 1);

  const api = await serverApi();
  const query = adminCreditsQuerySchema.parse({
    ...filters,
    page,
    pageSize: ADMIN_ORDERS_PAGE_SIZE,
  });
  const list = await api.credits.list({ query });
  if (list.status === 401) redirect('/login');
  if (list.status !== 200) throw new Error(`credits failed to load: ${list.status}`);
  const last = Math.max(1, Math.ceil(list.body.total / list.body.pageSize));
  if (page > last) {
    const q = new URLSearchParams(filters);
    if (last > 1) q.set('page', String(last));
    redirect(q.size ? `/credits?${q}` : '/credits');
  }
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
