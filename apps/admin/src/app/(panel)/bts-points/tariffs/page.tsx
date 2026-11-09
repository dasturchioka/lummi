import { redirect } from 'next/navigation';
import { TariffsManager } from '@/components/tariffs-manager';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function TariffsPage() {
  const api = await serverApi();
  const me = await api.me();
  if (me.status !== 200) redirect('/login');
  if (me.body.role !== 'owner') redirect('/bts-points'); // tariffs are the owner's
  const regions = await api.regions.list();
  if (regions.status === 401) redirect('/login');
  if (regions.status !== 200) throw new Error('could not load regions');
  const { language, t } = await getAdminMessages();
  return <TariffsManager initial={regions.body} language={language} t={t} />;
}
