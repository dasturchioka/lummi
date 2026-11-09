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
  { id: 'home', to: '/', icon: <HomeIcon size={20} /> },
  { id: 'catalog', to: '/catalog', icon: <GridIcon size={20} /> },
  { id: 'cart', to: '/cart', icon: <BagIcon size={20} /> },
  { id: 'orders', to: '/orders', icon: <BoxIcon size={20} /> },
  { id: 'profile', to: '/profile', icon: <UserIcon size={20} /> },
];

/**
 * The approved floating bar: a solid Graphite pill (Dark Block in dark), flat, inset 12 px from
 * the sides and the bottom safe area. The active tab is a Milk disc with a Graphite icon.
 */
export function TabBar({ badges = {} }: { badges?: Partial<Record<TabId, number>> }) {
  const { t } = usePrefs();
  return (
    <nav
      aria-label="LUMMI"
      className="fixed z-30 mx-auto flex h-[var(--tabbar-h)] max-w-[496px] items-center justify-around rounded-pill bg-bar px-2"
      style={{
        left: 'var(--tabbar-inset)',
        right: 'var(--tabbar-inset)',
        bottom: 'calc(var(--tabbar-inset) + var(--safe-b, 0px))',
      }}
    >
      {TABS.map((tab) => {
        const count = badges[tab.id] ?? 0;
        return (
          <Link
            key={tab.id}
            to={tab.to}
            activeOptions={{ exact: tab.to === '/' }}
            className="group flex min-w-0 flex-1 flex-col items-center gap-0.5 text-bar-ink data-[status=active]:text-bar-active"
          >
            <span className="relative grid size-8 place-items-center rounded-pill transition-colors duration-150 group-data-[status=active]:bg-bar-active group-data-[status=active]:text-bar-active-ink">
              {tab.icon}
              {count > 0 ? (
                <span className="absolute -top-0.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-pill bg-bar-active px-1 text-[10px] leading-none font-semibold text-bar-active-ink ring-2 ring-bar">
                  {count}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate text-[11px] leading-[13px] font-medium group-data-[status=active]:font-semibold">
              {t.tabs[tab.id]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
