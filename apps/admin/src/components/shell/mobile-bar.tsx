'use client';

import type { StaffDto } from '@lummi/contracts';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { PrefsSwitches } from '@/components/prefs-switches';
import type { Theme } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import type { AdminMessages } from '@/lib/i18n';
import { HomeLogo, NavScroller, PanelAccount, PanelNav } from './panel-nav';

/**
 * Below 1024 px: a 56 px top bar (logo, RU/UZ, menu button) and the same menu in a sheet from
 * the left. The sheet closes on a menu tap, Esc, or a tap on the dimmed page.
 */
export function MobileBar({
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
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-milk pr-1.5 pl-1 pt-[env(safe-area-inset-top)] box-content lg:hidden">
        <HomeLogo />
        <div className="flex items-center gap-1">
          <PrefsSwitches
            language={language}
            theme={theme}
            labels={{ language: t.language, theme: t.theme }}
            className="gap-1"
          />
          <DialogPrimitive.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label={t.nav.menu}>
              <Menu className="size-[22px]" strokeWidth={1.5} aria-hidden />
            </Button>
          </DialogPrimitive.Trigger>
        </div>
      </header>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="motion-overlay fixed inset-0 z-50 bg-overlay lg:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="motion-sheet fixed inset-y-0 left-0 z-50 flex w-[min(304px,86vw)] flex-col bg-milk pt-[env(safe-area-inset-top)] pb-[max(16px,env(safe-area-inset-bottom))] outline-none lg:hidden"
        >
          <DialogPrimitive.Title className="sr-only">{t.nav.label}</DialogPrimitive.Title>
          <div className="flex h-14 shrink-0 items-center justify-between pr-1.5 pl-1">
            <HomeLogo onNavigate={close} />
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t.nav.close}>
                <X className="size-[22px]" strokeWidth={1.5} aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <NavScroller
            className="px-3 pt-1 pb-3"
            footerClassName="mx-3"
            footer={<PanelAccount member={member} t={t} />}
          >
            <PanelNav role={member.role} t={t} onNavigate={close} />
          </NavScroller>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
