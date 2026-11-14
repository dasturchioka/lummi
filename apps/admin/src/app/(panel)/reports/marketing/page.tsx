import { salesReportQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { MarketingReportView } from '@/components/reports/marketing-report';
import { getAdminMessages } from '@/lib/i18n';
import { readFilters, type Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';

const KEYS = ['from', 'to'] as const;

export default async function MarketingReportPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const range = readFilters(await searchParams, salesReportQuerySchema.shape, KEYS);
  const api = await serverApi();
  let res = await api.reports.marketing({ query: range });
  // a range that runs backwards or passes a year: say so over the default range
  const invalid = res.status === 422;
  if (invalid) res = await api.reports.marketing({ query: {} });
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/'); // reports are the owner's
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (res.status !== 200) throw new Error(`marketing report failed to load: ${res.status}`);
  const { language, t } = await getAdminMessages();
  return (
    <MarketingReportView
      t={t}
      language={language}
      data={res.body}
      asked={range}
      invalid={invalid}
    />
  );
}
