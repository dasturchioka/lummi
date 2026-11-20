import type { StaffDto } from '@lummi/contracts';
import type { AdminMessages } from '@/lib/i18n';
import { getTheme } from '@/lib/theme';
import { MobileBar } from './mobile-bar';
import { Sidebar } from './sidebar';

/**
 * The panel shell every admin screen sits in: a sidebar from 1024 px, a top bar with a menu
 * sheet below that, and a content column capped at 1120 px. Used by the (panel) layout and by
 * the root 404 when a signed-in member opens an unknown address.
 */
export async function PanelShell({
  member,
  language,
  t,
  children,
}: {
  member: StaffDto;
  language: 'ru' | 'uz';
  t: AdminMessages;
  children: React.ReactNode;
}) {
  const theme = await getTheme();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <Sidebar member={member} language={language} theme={theme} t={t} />
      <div className="min-w-0">
        <MobileBar member={member} language={language} theme={theme} t={t} />
        <main className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-16 sm:px-6 lg:px-10 lg:pt-10">
          {children}
        </main>
      </div>
    </div>
  );
}
