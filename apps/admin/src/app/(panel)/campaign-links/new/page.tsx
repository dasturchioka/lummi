import { redirect } from 'next/navigation';
import { CampaignForm } from '@/components/campaigns/campaign-form';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function NewCampaignLinkPage() {
  const api = await serverApi();
  const [promos, fragrances] = await Promise.all([
    api.promoCodes.list(),
    api.catalog.fragrances.list({ query: {} }),
  ]);
  if (promos.status === 401) redirect('/login');
  if (promos.status !== 200) redirect('/'); // the owner's; the API refuses a manager's save as well
  const { t } = await getAdminMessages();
  return (
    <CampaignForm
      initial={null}
      promoCodes={promos.body.map((p) => p.code)}
      fragrances={
        fragrances.status === 200
          ? fragrances.body.map((f) => ({ slug: f.slug, name: f.name, brand: f.originalBrand }))
          : []
      }
      t={t}
    />
  );
}
