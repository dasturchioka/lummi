import { redirect } from 'next/navigation';
import { CampaignList } from '@/components/campaigns/campaign-list';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function CampaignLinksPage() {
  const api = await serverApi();
  const [list, fragrances] = await Promise.all([
    api.campaignLinks.list(),
    api.catalog.fragrances.list({ query: {} }),
  ]);
  if (list.status === 401) redirect('/login');
  if (list.status === 403) redirect('/'); // campaign links are the owner's
  if (list.status !== 200) throw new Error(`campaign links failed to load: ${list.status}`);
  const names = Object.fromEntries(
    (fragrances.status === 200 ? fragrances.body : []).map((f) => [f.slug, f.name]),
  );
  const { t, language } = await getAdminMessages();
  return <CampaignList items={list.body} fragranceNames={names} language={language} t={t} />;
}
