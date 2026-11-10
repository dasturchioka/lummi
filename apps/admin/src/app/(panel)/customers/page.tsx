import { CUSTOMERS_PAGE_DEFAULT, customersQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { CustomersView } from '@/components/customers-view';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  // whatever the URL holds, only what the contract accepts reaches the API; the rest is dropped
  const parsed = customersQuerySchema.safeParse({
    q: one(sp.q),
    sort: one(sp.sort),
    page: one(sp.page),
    pageSize: CUSTOMERS_PAGE_DEFAULT,
  });
  const query = parsed.success
    ? parsed.data
    : customersQuerySchema.parse({ pageSize: CUSTOMERS_PAGE_DEFAULT });
  const api = await serverApi();
  const res = await api.customers.list({ query });
  if (res.status === 401) redirect('/login');
  if (res.status !== 200) throw new Error(`customers failed to load: ${res.status}`);
  // a page past the end (an old link, fewer rows after a search) opens the last one
  const last = Math.max(1, Math.ceil(res.body.total / res.body.pageSize));
  if (query.page > last) {
    const q = new URLSearchParams();
    if (query.q) q.set('q', query.q);
    if (query.sort !== 'newest') q.set('sort', query.sort);
    if (last > 1) q.set('page', String(last));
    redirect(q.size ? `/customers?${q}` : '/customers');
  }
  const { language, t } = await getAdminMessages();
  return (
    <CustomersView
      t={t}
      language={language}
      data={res.body}
      filters={{ q: query.q, sort: query.sort }}
    />
  );
}
