import { reportQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { SalesReportView, type TopOrder } from '@/components/reports/sales-report';
import { getAdminMessages } from '@/lib/i18n';
import { readFilters, type Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';

const KEYS = ['from', 'to'] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const range = readFilters(sp, reportQuerySchema.shape, KEYS);
  const top: TopOrder = sp.top === 'net' ? 'net' : 'units';

  const api = await serverApi();
  let res = await api.reports.sales({ query: range });
  // a range that runs backwards or passes a year: say so over the default range
  const invalid = res.status === 422;
  if (invalid) res = await api.reports.sales({ query: {} });
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/'); // reports are the owner's
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (res.status !== 200) throw new Error(`sales report failed to load: ${res.status}`);
  const { language, t } = await getAdminMessages();
  return (
    <SalesReportView
      t={t}
      language={language}
      data={res.body}
      asked={range}
      top={top}
      invalid={invalid}
    />
  );
}
