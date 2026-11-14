import { marketingReportQuerySchema, type MarketingReportQuery } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { MarketingReportView } from '@/components/reports/marketing-report';
import { getAdminMessages } from '@/lib/i18n';
import { readFilters, type Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';

const KEYS = ['from', 'to', 'source', 'code'] as const;

export default async function MarketingReportPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  // the schema checks each value (a Source the API knows, a well-formed code); others are dropped
  const asked = readFilters(
    await searchParams,
    marketingReportQuerySchema.shape,
    KEYS,
  ) as MarketingReportQuery;
  const { from, to, ...filters } = asked;
  const api = await serverApi();
  let res = await api.reports.marketing({ query: asked });
  // a range that runs backwards or passes a year: say so over the default range, filters kept
  const invalid = res.status === 422;
  if (invalid) res = await api.reports.marketing({ query: filters });
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/'); // reports are the owner's
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (res.status !== 200) throw new Error(`marketing report failed to load: ${res.status}`);
  // the code filter offers every promo code; a failed list only leaves «Все» and «Без промокода»
  const codes = await api.promoCodes.list();
  const { language, t } = await getAdminMessages();
  return (
    <MarketingReportView
      t={t}
      language={language}
      data={res.body}
      asked={{ from, to }}
      codes={codes.status === 200 ? codes.body.map((c) => c.code) : []}
      invalid={invalid}
    />
  );
}
