import { notFound, redirect } from 'next/navigation';
import { CampaignForm } from '@/components/campaigns/campaign-form';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function CampaignLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const api = await serverApi();
  const [one, promos, fragrances] = await Promise.all([
    api.campaignLinks.get({ params: { id } }),
    api.promoCodes.list(),
    api.catalog.fragrances.list({ query: {} }),
  ]);
  if (one.status === 401) redirect('/login');
  if (one.status === 404) notFound();
  if (one.status === 403) redirect('/'); // campaign links are the owner's
  if (one.status !== 200) throw new Error(`campaign link failed to load: ${one.status}`);
  const { t } = await getAdminMessages();
  return (
    <CampaignForm
      key={one.body.id}
      initial={one.body}
      promoCodes={promos.status === 200 ? promos.body.map((p) => p.code) : []}
      fragrances={
        fragrances.status === 200
          ? fragrances.body.map((f) => ({ slug: f.slug, name: f.name, brand: f.originalBrand }))
          : []
      }
      t={t}
    />
  );
}
