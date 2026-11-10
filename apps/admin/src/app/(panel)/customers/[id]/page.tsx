import { notFound, redirect } from 'next/navigation';
import { CustomerView } from '@/components/customer-view';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();
  const api = await serverApi();
  const res = await api.customers.get({ params: { id: Number(id) } });
  if (res.status === 401) redirect('/login');
  if (res.status === 404) notFound();
  if (res.status !== 200) throw new Error(`customer failed to load: ${res.status}`);
  const { language, t } = await getAdminMessages();
  return <CustomerView t={t} language={language} customer={res.body} />;
}
