import type { StaffDto } from '@lummi/contracts';
import { LanguageSwitch } from '@/components/language-switch';
import type { AdminMessages } from '@/lib/i18n';
import { HomeLogo, PanelAccount, PanelNav } from './panel-nav';

/**
 * Desktop (≥1024 px): a fixed 256 px column on the Milk ground, a hairline from the content.
 * Logo and RU/UZ on top, the menu (scrolls if it must), who is signed in at the foot.
 */
export function Sidebar({
  member,
  language,
  t,
}: {
  member: StaffDto;
  language: 'ru' | 'uz';
  t: AdminMessages;
}) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border lg:flex">
      <div className="flex items-center justify-between gap-2 px-3 pt-4 pb-3">
        <HomeLogo />
        <LanguageSwitch current={language} label={t.language} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        <PanelNav role={member.role} t={t} />
      </div>
      <div className="px-3 pb-4">
        <PanelAccount member={member} t={t} />
      </div>
    </aside>
  );
}
