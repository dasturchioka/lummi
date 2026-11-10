import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { BagIcon, BoxIcon, GridIcon, HomeIcon, UserIcon } from './icons';

export type TabId = 'home' | 'catalog' | 'cart' | 'orders' | 'profile';

export const TABS: {
  id: TabId;
  to: '/' | '/catalog' | '/cart' | '/orders' | '/profile';
  icon: ReactNode;
}[] = [
  { id: 'home', to: '/', icon: <HomeIcon size={22} /> },
  { id: 'catalog', to: '/catalog', icon: <GridIcon size={22} /> },
  { id: 'cart', to: '/cart', icon: <BagIcon size={22} /> },
  { id: 'orders', to: '/orders', icon: <BoxIcon size={22} /> },
  { id: 'profile', to: '/profile', icon: <UserIcon size={22} /> },
];

/** Screens under a tab whose path does not start with the tab's own: the info pages are Profile's. */
const SECTION_OF: { prefix: string; tab: TabId }[] = [{ prefix: '/info/', tab: 'profile' }];

/**
 * The approved floating bar: a solid Graphite pill in both themes, flat (a 1 px line-colour inset
 * edge keeps it apart from Graphite cards in dark; it vanishes on the light bar), 64 px tall, 20 px from
 * the screen sides and 12 px above the bottom safe area. Five equal-width cells, so the icons
 * keep an even rhythm; each is a 22 px icon over an 11 px label. The active icon sits in a 38 px
 * Milk disc and its label turns Milk at 600. A press dips the disc. A label never truncates: the
 * longest one (UZ «Buyurtmalar») may spill a few pixels past its cell, centred, beside short
 * neighbours. The count sits outside the icon's top-right corner, capped at «9+».
 * `floating={false}` renders it in the flow (component gallery). `hidden` slides it below the
 * screen edge while the keyboard is up (the shell decides), and back when it goes down.
 */
export function TabBar({
  badges = {},
  floating = true,
  hidden = false,
}: {
  badges?: Partial<Record<TabId, number>>;
  floating?: boolean;
  hidden?: boolean;
}) {
  const { t } = usePrefs();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = SECTION_OF.find((x) => pathname.startsWith(x.prefix))?.tab;
  return (
    <nav
      aria-label="LUMMI"
      inert={hidden || undefined}
      className={`z-30 mx-auto flex h-[var(--tabbar-h)] max-w-[480px] items-center rounded-pill bg-bar px-1 shadow-[inset_0_0_0_1px_var(--c-line)] transition-[translate,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] select-none ${
        floating ? 'fixed' : 'relative w-full'
      } ${hidden ? 'translate-y-[calc(100%+var(--tabbar-inset)+var(--safe-b,0px))] opacity-0' : ''}`}
      style={
        floating
          ? {
              left: 'max(var(--tabbar-side), var(--safe-l, 0px))',
              right: 'max(var(--tabbar-side), var(--safe-r, 0px))',
              bottom: 'calc(var(--tabbar-inset) + var(--safe-b, 0px))',
            }
          : undefined
      }
    >
      {TABS.map((tab) => {
        const count = badges[tab.id] ?? 0;
        return (
          <Link
            key={tab.id}
            to={tab.to}
            activeOptions={{ exact: tab.to === '/' }}
            // the Link marks its own path active; a section's other screens are marked here
            {...(section === tab.id ? { 'data-status': 'active', 'aria-current': 'page' } : {})}
            className="group flex h-full min-w-0 flex-1 basis-0 flex-col items-center justify-center text-bar-ink outline-offset-[-4px] transition-colors duration-150 hover:text-bar-active data-[status=active]:text-bar-active"
          >
            <span className="relative grid size-[38px] shrink-0 place-items-center rounded-pill transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-active:scale-90 group-data-[status=active]:bg-bar-active group-data-[status=active]:text-bar-active-ink">
              {tab.icon}
              {count > 0 ? (
                <span
                  aria-label={String(count)}
                  className="absolute top-[3px] left-[calc(50%+7px)] grid h-4 min-w-4 place-items-center rounded-pill bg-bar-active px-[3px] type-count text-bar-active-ink ring-2 ring-bar"
                >
                  {count > 9 ? '9+' : count}
                </span>
              ) : null}
            </span>
            <span className="type-tab -mt-px whitespace-nowrap group-data-[status=active]:font-semibold">
              {t.tabs[tab.id]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
