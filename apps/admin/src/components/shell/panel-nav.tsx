'use client';

import type { StaffDto } from '@lummi/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Logo } from '@/components/logo';
import { SignOutButton } from '@/components/sign-out-button';
import type { AdminMessages } from '@/lib/i18n';
import { isActive, navFor } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * The panel menu: sections grouped by job, the active one in a Graphite fill (as a selected chip
 * in the Mini App). Sections a later ticket has not built yet stay visible in Muted Ink and are
 * not links, so the panel's shape is clear from day one.
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
  // the owner's 14 sections overflow a phone's sheet: keep the current one in view on open
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [pathname]);
  return (
    <nav ref={ref} aria-label={t.nav.label} className="grid gap-4">
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
              const inner = (
                <>
                  <Icon className="size-[18px] shrink-0" strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0 truncate">{label}</span>
                </>
              );
              // 44 px rows for touch in the sheet, 32 px in the desktop sidebar (14 sections fit 768 px)
              const base =
                'flex h-11 items-center gap-3 rounded-button px-3 text-sm select-none lg:h-8';
              if (!href) {
                return (
                  <li key={key}>
                    <span
                      aria-disabled="true"
                      title={t.nav.soon}
                      className={cn(base, 'cursor-default text-muted-foreground')}
                    >
                      {inner}
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
                    {inner}
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

/** Who is signed in, and sign-out: the foot of the sidebar and of the menu sheet. */
export function PanelAccount({ member, t }: { member: StaffDto; t: AdminMessages }) {
  // first letters of the first two words that have one ("@dilnoza" -> "D", "Ж" -> "Ж")
  const initials = member.name
    .split(/\s+/)
    .map((w) => w.match(/\p{L}/u)?.[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="flex min-w-0 items-center gap-3 border-t border-border pt-3 pl-3">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full bg-stone text-[13px] font-semibold"
      >
        {initials}
      </span>
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

export function HomeLogo({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="inline-flex h-11 items-center rounded-button px-3"
      aria-label="LUMMI."
    >
      <Logo className="h-4" />
    </Link>
  );
}
