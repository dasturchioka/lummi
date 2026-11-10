import { redirect } from 'next/navigation';
import { SetsManager } from '@/components/sets-manager';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function SetsPage() {
  const api = await serverApi();
  const me = await api.me();
  if (me.status !== 200) redirect('/login');
  const owner = me.body.role === 'owner';
  const [set, list] = await Promise.all([
    api.sets.get(),
    // the fragrance list is the owner's; a manager only counts boxes
    owner ? api.catalog.fragrances.list({ query: {} }) : Promise.resolve(null),
  ]);
  if (set.status !== 200) redirect('/login');
  const options =
    list && list.status === 200
      ? list.body.map((f) => ({ id: f.id, name: f.name, hidden: f.hidden }))
      : [];
  const { language, t } = await getAdminMessages();
  return <SetsManager initial={set.body} options={options} owner={owner} language={language} t={t} />;
}
