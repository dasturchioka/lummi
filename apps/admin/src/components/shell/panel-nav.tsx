'use client';

import type { StaffDto } from '@lummi/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { Logo } from '@/components/logo';
import { SignOutButton } from '@/components/sign-out-button';
import type { AdminMessages } from '@/lib/i18n';
import { isActive, navFor } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * The panel menu: sections grouped by job, the active one in a Graphite fill (as a selected chip
 * in the Mini App). Sections a later ticket has not built yet stay listed in Muted Ink with a
 * «скоро» tag and are not links, so the panel's shape is clear from day one (a hover title alone
 * would say nothing on touch).
 */
export function PanelNav({
  role,
  t,
  onNavigate,
}: {
  role: StaffDto['role'];
  t: AdminMessages;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  // the owner's 14 sections can overflow a short phone: keep the current one in view on open
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [pathname]);
  return (
    <nav ref={ref} aria-label={t.nav.label} className="grid gap-2.5 lg:gap-4">
      {navFor(role).map((group) => (
        <div key={group.key ?? 'top'}>
          {group.key && (
            <p className="px-3 pb-1 text-xs leading-4 font-medium text-muted-foreground">
              {t.nav.groups[group.key]}
            </p>
          )}
          <ul className="grid gap-0.5">
            {group.items.map(({ key, icon: Icon, href }) => {
              const label = t.nav[key];
              // 40 px rows in the sheet, 32 px in the desktop sidebar (14 sections fit 768 px)
              const base =
                'flex h-10 items-center gap-2.5 rounded-button px-3 text-sm select-none lg:h-8';
              const icon = <Icon className="size-[18px] shrink-0" strokeWidth={1.5} aria-hidden />;
              if (!href) {
                return (
                  <li key={key}>
                    <span
                      aria-disabled="true"
                      title={t.nav.soon}
                      className={cn(base, 'cursor-default text-muted-foreground')}
                    >
                      {icon}
                      <span className="min-w-0 truncate">{label}</span>
                      <span className="ml-auto shrink-0 text-xs text-faint">{t.nav.soonTag}</span>
                    </span>
                  </li>
                );
              }
              const active = isActive(href, pathname);
              return (
                <li key={key}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      base,
                      'font-medium transition-colors duration-150',
                      active
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : 'text-foreground hover:bg-field active:bg-field',
                    )}
                  >
                    {icon}
                    <span className="min-w-0 truncate">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The scrolling menu with the account pinned under it. The hairline above the account appears
 * only while menu items scroll underneath it.
 */
export function NavScroller({
  children,
  footer,
  className,
  footerClassName,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
  className?: string;
  footerClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setUnder(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);
  return (
    <>
      <div ref={ref} className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', className)}>
        {children}
      </div>
      <div
        className={cn(
          'border-t pt-3 transition-colors duration-150',
          under ? 'border-border' : 'border-transparent',
          footerClassName,
        )}
      >
        {footer}
      </div>
    </>
  );
}

/** Who is signed in, and sign-out: the foot of the sidebar and of the menu sheet. */
export function PanelAccount({ member, t }: { member: StaffDto; t: AdminMessages }) {
  return (
    <div className="flex min-w-0 items-center gap-3 pl-3">
      <Avatar name={member.name} photo={member.photo} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold" title={member.name}>
          {member.name}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
          {t.roles[member.role]}
        </p>
      </div>
      <SignOutButton label={t.nav.signOut} />
    </div>
  );
}

/** The wordmark home link; 14 px tall (105 px wide, above the 80 px minimum) beside RU/UZ. */
export function HomeLogo({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="inline-flex h-11 shrink-0 items-center rounded-button px-3"
      aria-label="LUMMI."
    >
      <Logo className="h-3.5" />
    </Link>
  );
}
