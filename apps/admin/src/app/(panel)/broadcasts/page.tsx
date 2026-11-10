import { redirect } from 'next/navigation';
import { BroadcastList } from '@/components/broadcasts/broadcast-list';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function BroadcastsPage() {
  const api = await serverApi();
  const list = await api.broadcasts.list();
  if (list.status === 401) redirect('/login');
  if (list.status === 403) redirect('/'); // broadcasts are the owner's
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (list.status !== 200) throw new Error(`broadcasts failed to load: ${list.status}`);
  const { t, language } = await getAdminMessages();
  return <BroadcastList initial={list.body} language={language} t={t} />;
}
