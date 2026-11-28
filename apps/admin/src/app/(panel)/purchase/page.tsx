import { redirect } from 'next/navigation';
import { PurchasePlanView } from '@/components/purchase/purchase-plan-view';
import { getAdminMessages } from '@/lib/i18n';
import type { Search } from '@/lib/list-page';
import { readPlanQuery } from '@/lib/purchase-query';
import { serverApi } from '@/lib/server-api';

export default async function PurchasePage({ searchParams }: { searchParams: Promise<Search> }) {
  const query = readPlanQuery(await searchParams);
  const res = await (await serverApi()).purchasePlan({ query });
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/'); // the planner is the owner's
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (res.status !== 200) throw new Error(`purchase plan failed to load: ${res.status}`);
  const { language, t } = await getAdminMessages();
  return <PurchasePlanView t={t} language={language} plan={res.body} query={query} />;
}
