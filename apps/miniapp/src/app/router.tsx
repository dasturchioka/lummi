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
import { useEffect } from 'react';
import { showBackButton } from '../lib/back-button';
import { Home } from '../screens/Home';
import { TabBar, TABS } from '../ui/TabBar';

const TAB_ROOTS: string[] = TABS.map((t) => t.to);

function Shell() {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const isRoot = TAB_ROOTS.includes(pathname);

  // Telegram's native back button: visible on screens deeper than a tab root.
  useEffect(() => showBackButton(!isRoot, () => router.history.back()), [isRoot, router]);

  return (
    <>
      <Outlet />
      <TabBar />
    </>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const at = (path: string) => ({ getParentRoute: () => rootRoute, path });

/*
 * Component gallery, development only: `/dev/ui`, `/dev/sheet` with the sheet open, and `/dev/delivery` hosting the BTS point picker.
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
        ...at('/dev/delivery'),
        component: lazyRouteComponent(() => import('../dev/Delivery'), 'DeliveryDev'),
      }),
      createRoute({
        ...at('/dev/sheet'),
        component: lazyRouteComponent(() => import('../dev/Gallery'), 'GallerySheetOpen'),
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
