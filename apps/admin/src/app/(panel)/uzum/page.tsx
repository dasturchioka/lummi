import { formatLocalDate, tashkentDay, uzumSalesQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { UzumSalesView } from '@/components/uzum/uzum-sales-view';
import { getAdminMessages } from '@/lib/i18n';
import { getMe, serverApi } from '@/lib/server-api';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Uzum sales (#80): owner and managers record and void them; the owner also sees their profit. */
export default async function UzumSalesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const parsed = uzumSalesQuerySchema.safeParse({ page: one(sp.page) });
  const query = parsed.success ? parsed.data : uzumSalesQuerySchema.parse({});
  const api = await serverApi();
  const [res, me] = await Promise.all([api.uzum.list({ query }), getMe()]);
  if (res.status === 401) redirect('/login');
  if (res.status !== 200) throw new Error(`uzum sales failed to load: ${res.status}`);
  const pages = Math.max(1, Math.ceil(res.body.total / res.body.pageSize));
  if (query.page > pages) redirect(pages > 1 ? `/uzum?page=${pages}` : '/uzum');
  const { t, language } = await getAdminMessages();
  return (
    <UzumSalesView
      data={res.body}
      owner={me.status === 200 && me.body.role === 'owner'}
      today={formatLocalDate(tashkentDay(new Date()))}
      language={language}
      t={t}
    />
  );
}
