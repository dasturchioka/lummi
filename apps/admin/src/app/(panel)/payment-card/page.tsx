import { redirect } from 'next/navigation';
import { ShopCardEditor } from '@/components/shop-card-editor';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

/** Owner only (#28): the card shoppers transfer to. */
export default async function PaymentCardPage() {
  const api = await serverApi();
  const res = await api.shopCard.get();
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/'); // managers have no card page
  if (res.status !== 200) throw new Error(`shop card failed to load: ${res.status}`);
  const { t } = await getAdminMessages();
  return <ShopCardEditor card={res.body.card} t={t} />;
}
