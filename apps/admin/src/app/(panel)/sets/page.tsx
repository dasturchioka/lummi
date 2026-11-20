import { redirect } from 'next/navigation';
import { SetsManager } from '@/components/sets-manager';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function SetsPage() {
  const api = await serverApi();
  const me = await api.me();
  if (me.status !== 200) redirect('/login');
  const owner = me.body.role === 'owner';
  const [ten, five, list] = await Promise.all([
    api.sets.get({ query: { vialMl: 10 } }),
    api.sets.get({ query: { vialMl: 5 } }),
    // the fragrance list is the owner's; a manager only counts boxes
    owner ? api.catalog.fragrances.list({ query: {} }) : Promise.resolve(null),
  ]);
  if (ten.status !== 200 || five.status !== 200) redirect('/login');
  const options =
    list && list.status === 200
      ? list.body.map((f) => ({ id: f.id, name: f.name, hidden: f.hidden }))
      : [];
  const { language, t } = await getAdminMessages();
  return (
    <SetsManager
      sets={[ten.body, five.body]}
      options={options}
      owner={owner}
      language={language}
      t={t}
    />
  );
}
