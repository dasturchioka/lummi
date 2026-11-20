import { formatLocalDate, tashkentDay } from '@lummi/contracts';
import { HomeView } from '@/components/home/home-view';
import { getAdminMessages } from '@/lib/i18n';
import { getMe } from '@/lib/server-api';

/**
 * The admin root (#48): the work-queue Home for both roles. The browser loads it from one call
 * (`GET /admin/home`) and refreshes it; the server only names who is signed in (the skeleton has
 * the owner's sales strip or not) and today's Tashkent day for the date line.
 */
export default async function HomePage() {
  const { language, t } = await getAdminMessages();
  const me = await getMe();
  const role = me.status === 200 ? me.body.role : 'manager';
  return (
    <HomeView
      copy={t.home}
      title={t.nav.home}
      retry={t.actions.retry}
      language={language}
      role={role}
      today={formatLocalDate(tashkentDay(new Date()))}
    />
  );
}
