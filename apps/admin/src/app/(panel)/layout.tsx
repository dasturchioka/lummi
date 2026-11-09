import { redirect } from 'next/navigation';
import { MobileBar } from '@/components/shell/mobile-bar';
import { Sidebar } from '@/components/shell/sidebar';
import { getAdminMessages } from '@/lib/i18n';
import { getMe } from '@/lib/server-api';

/**
 * The panel shell every admin screen sits in: a sidebar from 1024 px, a top bar with a menu
 * sheet below that, and a content column capped at 1120 px.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (me.status !== 200) redirect('/login');
  const { language, t } = await getAdminMessages();
  const member = me.body;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <Sidebar member={member} language={language} t={t} />
      <div className="min-w-0">
        <MobileBar member={member} language={language} t={t} />
        <main className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-16 sm:px-6 lg:px-10 lg:pt-10">
          {children}
        </main>
      </div>
    </div>
  );
}
