import { Link } from '@tanstack/react-router';
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

/**
 * The approved floating bar: a solid Graphite pill (Dark Block in dark), flat, inset 12 px from
 * the sides and the bottom safe area. Each tab is a 22 px icon over an 11 px label; the active
 * tab's icon sits in a Milk disc and its label turns Milk at 600. A press dips the disc.
 * Cells share the width equally (an even icon rhythm); a cell grows to its label only when the
 * label would not fit (UZ «Bosh sahifa» / «Buyurtmalar» at 320 px or with large system text),
 * so a label is never truncated.
 * `floating={false}` renders it in the flow (component gallery).
 */
export function TabBar({
  badges = {},
  floating = true,
}: {
  badges?: Partial<Record<TabId, number>>;
  floating?: boolean;
}) {
  const { t } = usePrefs();
  return (
    <nav
      aria-label="LUMMI"
      className={`z-30 mx-auto flex h-[var(--tabbar-h)] max-w-[496px] items-center rounded-pill bg-bar px-1.5 select-none ${
        floating ? 'fixed' : 'relative w-full'
      }`}
      style={
        floating
          ? {
              left: 'var(--tabbar-inset)',
              right: 'var(--tabbar-inset)',
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
            className="group flex h-full min-w-min flex-1 flex-col items-center justify-center gap-px text-bar-ink outline-offset-[-4px] transition-colors duration-150 hover:text-bar-active data-[status=active]:text-bar-active"
          >
            <span className="relative grid size-[34px] place-items-center rounded-pill transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-active:scale-90 group-data-[status=active]:bg-bar-active group-data-[status=active]:text-bar-active-ink">
              {tab.icon}
              {count > 0 ? (
                <span className="absolute -top-0.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-pill bg-bar-active px-1 type-count text-bar-active-ink ring-2 ring-bar">
                  {count > 99 ? '99+' : count}
                </span>
              ) : null}
            </span>
            <span className="type-tab px-1 whitespace-nowrap group-data-[status=active]:font-semibold">
              {t.tabs[tab.id]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
