import { redirect } from 'next/navigation';
import { BroadcastComposer } from '@/components/broadcasts/composer';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function NewBroadcastPage() {
  const api = await serverApi();
  const count = await api.broadcasts.audience({ query: { audience: 'all' } });
  if (count.status === 401) redirect('/login');
  if (count.status === 403) redirect('/'); // broadcasts are the owner's
  if (count.status !== 200) throw new Error(`audience count failed to load: ${count.status}`);
  const { t, language } = await getAdminMessages();
  return <BroadcastComposer initialCount={count.body} language={language} t={t} />;
}
