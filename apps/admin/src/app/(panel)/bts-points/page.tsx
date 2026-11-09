import { redirect } from 'next/navigation';
import { BtsPointsManager } from '@/components/bts-points-manager';
import { getAdminMessages } from '@/lib/i18n';
import { getMe, serverApi } from '@/lib/server-api';

type Search = { region?: string; status?: string; q?: string; page?: string };

export default async function BtsPointsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const api = await serverApi();
  const regionId = Number(sp.region) > 0 ? Number(sp.region) : undefined;
  const status = sp.status === 'active' || sp.status === 'hidden' ? sp.status : 'all';
  const page = Math.max(1, Number(sp.page) || 1);
  const [regions, points, me] = await Promise.all([
    api.regions.list(),
    api.btsPoints.list({ query: { regionId, status, q: sp.q || undefined, page } }),
    getMe(),
  ]);
  if (regions.status === 401 || points.status === 401) redirect('/login');
  if (regions.status !== 200 || points.status !== 200 || me.status !== 200) {
    throw new Error('could not load BTS points');
  }
  const { language, t } = await getAdminMessages();
  return (
    <BtsPointsManager
      regions={regions.body}
      page={points.body}
      filters={{ regionId, status, q: sp.q ?? '' }}
      isOwner={me.body.role === 'owner'}
      language={language}
      t={t}
    />
  );
}
