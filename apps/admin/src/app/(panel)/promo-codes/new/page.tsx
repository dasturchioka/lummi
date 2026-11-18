import { redirect } from 'next/navigation';
import { PromoForm } from '@/components/promo/promo-form';
import { getAdminMessages } from '@/lib/i18n';
import { giftChoicesOf } from '@/components/promo/gift-choices';
import { getMe, serverApi } from '@/lib/server-api';

export default async function NewPromoCodePage() {
  const me = await getMe();
  if (me.status === 401) redirect('/login');
  // promo codes are the owner's; the API refuses a manager's save as well
  if (me.status !== 200 || me.body.role !== 'owner') redirect('/');
  const { t, language } = await getAdminMessages();
  const giftChoices = await giftChoicesOf(await serverApi());
  return <PromoForm initial={null} giftChoices={giftChoices} language={language} t={t} />;
}
