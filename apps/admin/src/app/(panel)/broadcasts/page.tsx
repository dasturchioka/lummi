import { redirect } from 'next/navigation';
import { BroadcastList } from '@/components/broadcasts/broadcast-list';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function BroadcastsPage() {
  const api = await serverApi();
  const list = await api.broadcasts.list();
  if (list.status === 401) redirect('/login');
  if (list.status !== 200) redirect('/'); // 403: broadcasts are the owner's
  const { t, language } = await getAdminMessages();
  return <BroadcastList initial={list.body} language={language} t={t} />;
}
