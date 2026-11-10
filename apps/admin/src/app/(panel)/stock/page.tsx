import { stockQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { StockView } from '@/components/stock-view';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function StockPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  // whatever the URL holds, only what the contract accepts reaches the API
  const parsed = stockQuerySchema.safeParse({
    q: one(sp.q),
    filter: one(sp.filter),
    visibility: one(sp.visibility),
  });
  const query = parsed.success ? parsed.data : {};
  const api = await serverApi();
  const res = await api.stock.list({ query });
  if (res.status === 401) redirect('/login');
  if (res.status !== 200) throw new Error(`stock failed to load: ${res.status}`);
  const { language, t } = await getAdminMessages();
  return <StockView t={t} language={language} data={res.body} query={query} />;
}
