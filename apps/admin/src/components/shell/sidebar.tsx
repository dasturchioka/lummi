import type { StaffDto } from '@lummi/contracts';
import { LanguageSwitch } from '@/components/language-switch';
import { ThemeSwitch } from '@/components/theme-switch';
import type { Theme } from '@/lib/theme-cookie';
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
      <div className="flex items-center justify-between gap-2 px-3 pt-4 pb-3">
        <HomeLogo />
        <div className="flex items-center gap-1.5">
          <LanguageSwitch current={language} label={t.language} />
          <ThemeSwitch current={theme} label={t.theme.label} names={t.theme} />
        </div>
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
