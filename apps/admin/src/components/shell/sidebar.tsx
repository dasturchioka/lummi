import type { StaffDto } from '@lummi/contracts';
import { LanguageSwitch } from '@/components/prefs-switches';
import type { Theme } from '@/lib/theme';
import type { AdminMessages } from '@/lib/i18n';
import { HomeLogo, NavScroller, PanelAccount, PanelNav } from './panel-nav';

/**
 * Desktop (≥1024 px): a fixed 280 px column on the Milk ground, a hairline from the content.
 * Logo and RU/UZ on one row on top, the menu (scrolls if it must), and at the foot who is signed
 * in, with the theme and sign-out (#74: the theme pair with its words overflowed 280 px in UZ).
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
      <div className="flex items-center justify-between gap-2 pt-4 pr-3 pb-3 pl-3">
        <HomeLogo />
        <LanguageSwitch language={language} label={t.language} />
      </div>
      <NavScroller
        className="px-3 pb-3"
        footerClassName="mx-3 mb-4"
        footer={<PanelAccount member={member} theme={theme} t={t} />}
      >
        <PanelNav role={member.role} t={t} />
      </NavScroller>
    </aside>
  );
}
