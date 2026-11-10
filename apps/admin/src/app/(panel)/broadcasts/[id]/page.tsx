import { notFound, redirect } from 'next/navigation';
import { BroadcastDetail } from '@/components/broadcasts/broadcast-detail';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function BroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const api = await serverApi();
  const one = await api.broadcasts.get({ params: { id } });
  if (one.status === 401) redirect('/login');
  if (one.status === 404) notFound();
  if (one.status === 403) redirect('/'); // broadcasts are the owner's
  if (one.status !== 200) throw new Error(`broadcast failed to load: ${one.status}`);
  const { t, language } = await getAdminMessages();
  return <BroadcastDetail key={one.body.id} initial={one.body} language={language} t={t} />;
}
