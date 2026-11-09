import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  createBrowserHistory,
  lazyRouteComponent,
  redirect,
  useRouter,
} from '@tanstack/react-router';
import { SEARCH_QUERY_MAX } from '@lummi/contracts/client';
import { useEffect } from 'react';
import { showBackButton } from '../lib/back-button';
import { goBackOrCatalog } from '../lib/navigation';
import { Home } from '../screens/Home';
import { TabBar, TABS } from '../ui/TabBar';

const TAB_ROOTS: string[] = TABS.map((t) => t.to);

function Shell() {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const isRoot = TAB_ROOTS.includes(pathname);
  // The fragrance card (it carries its own dock, also on its fixtures) and the search are task screens: no tab bar.
  const showTabBar =
    !pathname.startsWith('/p/') && pathname !== '/search' && pathname !== '/dev/fragrance';

  // Telegram's native back button: visible on screens deeper than a tab root.
  useEffect(() => showBackButton(!isRoot, () => goBackOrCatalog(router)), [isRoot, router]);

  return (
    <>
      <Outlet />
      {showTabBar ? <TabBar /> : null}
    </>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const at = (path: string) => ({ getParentRoute: () => rootRoute, path });

/*
 * Component gallery, development only: `/dev/ui`, and `/dev/sheet` with the sheet open.
 * `import.meta.env.DEV` is `false` in a build, so these routes and their lazy chunk are dropped;
 * `npm run size` fails if the gallery ever reaches dist.
 */
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        ...at('/dev/ui'),
        component: lazyRouteComponent(() => import('../dev/Gallery'), 'Gallery'),
      }),
      createRoute({
        ...at('/dev/sheet'),
        component: lazyRouteComponent(() => import('../dev/Gallery'), 'GallerySheetOpen'),
      }),
      createRoute({
        ...at('/dev/registration'),
        component: lazyRouteComponent(() => import('../dev/Gallery'), 'GalleryRegistrationOpen'),
      }),
      // The fragrance card on fixtures: `?data=demo|worst|one|empty` (worst by default).
      createRoute({
        ...at('/dev/fragrance'),
        validateSearch: (s: Record<string, unknown>) => ({
          data: (['demo', 'worst', 'one', 'empty'] as const).find((n) => n === s.data) ?? 'worst',
        }),
        component: lazyRouteComponent(
          () => import('../dev/FragranceFixtures'),
          'FragranceFixtures',
        ),
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  createRoute({ ...at('/'), component: Home }),
  createRoute({
    ...at('/catalog'),
    component: lazyRouteComponent(() => import('../screens/Tabs'), 'CatalogTab'),
  }),
  createRoute({
    ...at('/search'),
    validateSearch: (s: Record<string, unknown>): { q?: string; s?: number } => ({
      ...(typeof s.q === 'string' && s.q !== '' ? { q: s.q.slice(0, SEARCH_QUERY_MAX) } : {}),
      ...(Number(s.s) === 1 ? { s: 1 } : {}),
    }),
    component: lazyRouteComponent(() => import('../screens/Search'), 'Search'),
  }),
  createRoute({
    ...at('/p/$slug'),
    component: lazyRouteComponent(() => import('../screens/Fragrance'), 'Fragrance'),
  }),
  createRoute({
    ...at('/cart'),
    component: lazyRouteComponent(() => import('../screens/Tabs'), 'CartTab'),
  }),
  createRoute({
    ...at('/orders'),
    component: lazyRouteComponent(() => import('../screens/Tabs'), 'OrdersTab'),
  }),
  createRoute({
    ...at('/profile'),
    component: lazyRouteComponent(() => import('../screens/Profile'), 'Profile'),
  }),
  ...devRoutes,
  // Anything unknown lands on Home.
  createRoute({
    ...at('$'),
    beforeLoad: () => {
      throw redirect({ to: '/', replace: true });
    },
  }),
]);

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
