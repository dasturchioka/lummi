import { redirect } from 'next/navigation';
import { PromoList } from '@/components/promo/promo-list';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function PromoCodesPage() {
  const api = await serverApi();
  const list = await api.promoCodes.list();
  if (list.status === 401) redirect('/login');
  if (list.status === 403) redirect('/'); // promo codes are the owner's
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (list.status !== 200) throw new Error(`promo codes failed to load: ${list.status}`);
  const { t, language } = await getAdminMessages();
  return <PromoList items={list.body} language={language} t={t} />;
}
