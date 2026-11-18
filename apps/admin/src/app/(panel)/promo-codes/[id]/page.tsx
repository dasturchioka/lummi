import { notFound, redirect } from 'next/navigation';
import { PromoForm } from '@/components/promo/promo-form';
import { giftChoicesOf } from '@/components/promo/gift-choices';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function PromoCodePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const api = await serverApi();
  const one = await api.promoCodes.get({ params: { id } });
  if (one.status === 401) redirect('/login');
  if (one.status === 404) notFound();
  if (one.status === 403) redirect('/'); // promo codes are the owner's
  if (one.status !== 200) throw new Error(`promo code failed to load: ${one.status}`);
  const { t, language } = await getAdminMessages();
  const giftChoices = await giftChoicesOf(api);
  return (
    <PromoForm
      key={one.body.id}
      initial={one.body}
      giftChoices={giftChoices}
      language={language}
      t={t}
    />
  );
}
