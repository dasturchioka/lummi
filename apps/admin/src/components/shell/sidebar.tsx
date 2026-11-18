import type { StaffDto } from '@lummi/contracts';
import { PrefsSwitches } from '@/components/prefs-switches';
import type { Theme } from '@/lib/theme';
import type { AdminMessages } from '@/lib/i18n';
import { HomeLogo, NavScroller, PanelAccount, PanelNav } from './panel-nav';

/**
 * Desktop (≥1024 px): a fixed 280 px column on the Milk ground, a hairline from the content.
 * Logo and RU/UZ on top, the menu (scrolls if it must), who is signed in at the foot.
 */
export function Sidebar({
  member,
  language,
  theme,
  t,
}: {
  member: StaffDto;
  language: 'ru' | 'uz';
  theme: Theme;
  t: AdminMessages;
}) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border lg:flex">
      <div className="grid gap-3 px-3 pt-4 pb-3">
        <HomeLogo />
        <PrefsSwitches
          language={language}
          theme={theme}
          labels={{ language: t.language, theme: t.theme }}
          words
        />
      </div>
      <NavScroller
        className="px-3 pb-3"
        footerClassName="mx-3 mb-4"
        footer={<PanelAccount member={member} t={t} />}
      >
        <PanelNav role={member.role} t={t} />
      </NavScroller>
    </aside>
  );
}
