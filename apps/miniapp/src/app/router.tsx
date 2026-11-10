import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  createBrowserHistory,
  lazyRouteComponent,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { parseBuyNowParam } from '@lummi/contracts/buy-now';
import { SEARCH_QUERY_MAX } from '@lummi/contracts/constants';
import { useEffect } from 'react';
import { showBackButton } from '../lib/back-button';
import { goBackOrCatalog } from '../lib/navigation';
import { parseCatalogSearch } from '../catalog/filters';
import { Home } from '../screens/Home';
import { useCartCount } from '../cart/queries';
import { ShopNote } from '../ui/ShopNote';
import { TabBar, TABS } from '../ui/TabBar';

const TAB_ROOTS: string[] = TABS.map((t) => t.to);

/** An order number as a path takes it; any other `/orders/<x>` goes back to «Заказы». */
const ORDER_NUMBER = '[1-9]\\d{0,9}';
const isOrderNumber = (s: string) => new RegExp(`^${ORDER_NUMBER}$`).test(s);
/** The payment screen of an order (#28): a task screen, with no tab bar. */
const PAY_PATH = new RegExp(`^/orders/${ORDER_NUMBER}/pay$`);

function Shell() {
  const router = useRouter();
  // Subscribed: `router.state` read directly does not re-render the shell on navigation, so a task
  // screen opened from another screen (an order → its payment) kept the tab bar over its dock. The
  // resolved location is the screen on show: a lazy route keeps the previous screen until its
  // chunk arrives, and the tab bar changes with the screen, not a beat before it.
  const pathname = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname });
  const isRoot = TAB_ROOTS.includes(pathname);
  // The fragrance card (it carries its own dock, also on its fixtures), the search, the checkout and the payment screen are task screens: no tab bar.
  const showTabBar =
    !pathname.startsWith('/p/') &&
    !pathname.startsWith('/sets/') &&
    pathname !== '/search' &&
    pathname !== '/dev/fragrance' &&
    pathname !== '/checkout' &&
    !PAY_PATH.test(pathname);
  const cartCount = useCartCount();

  // Telegram's native back button: visible on screens deeper than a tab root.
  useEffect(() => showBackButton(!isRoot, () => goBackOrCatalog(router)), [isRoot, router]);

  return (
    <>
      <Outlet />
      <ShopNote tabBar={showTabBar} />
      {showTabBar ? <TabBar badges={{ cart: cartCount }} /> : null}
    </>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const at = (path: string) => ({ getParentRoute: () => rootRoute, path });

/*
 * Component gallery, development only: `/dev/ui`, `/dev/list` (the list cards alone), `/dev/sheet` with the sheet open, and `/dev/delivery` hosting the BTS point picker.
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
        ...at('/dev/list'),
        component: lazyRouteComponent(() => import('../dev/Gallery'), 'GalleryListCards'),
      }),
      createRoute({
        ...at('/dev/sheet'),
        component: lazyRouteComponent(() => import('../dev/Gallery'), 'GallerySheetOpen'),
      }),
      createRoute({
        ...at('/dev/registration'),
        component: lazyRouteComponent(() => import('../dev/Gallery'), 'GalleryRegistrationOpen'),
      }),
      createRoute({
        ...at('/dev/cart'),
        validateSearch: (s: Record<string, unknown>) => ({
          data:
            (['discount', 'plain', 'worst', 'worst-nudge', 'unavailable'] as const).find(
              (n) => n === s.data,
            ) ?? 'discount',
        }),
        component: lazyRouteComponent(() => import('../dev/CartFixtures'), 'CartFixtures'),
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

/** Both set screens live in one chunk: one loader, so the entry carries its preload list once. */
const setsScreens = () => import('../screens/Sets');

const routeTree = rootRoute.addChildren([
  createRoute({ ...at('/'), component: Home }),
  createRoute({
    ...at('/catalog'),
    validateSearch: parseCatalogSearch,
    component: lazyRouteComponent(() => import('../screens/Catalog'), 'Catalog'),
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
    ...at('/sets/discovery'),
    component: lazyRouteComponent(setsScreens, 'DiscoverySetScreen'),
  }),
  createRoute({
    ...at('/sets/builder'),
    // `?pick=a,b,c`: the cart's «Изменить набор» opens the builder with that line's picks
    validateSearch: (s: Record<string, unknown>): { pick?: string } =>
      typeof s.pick === 'string' && s.pick !== '' ? { pick: s.pick.slice(0, 400) } : {},
    component: lazyRouteComponent(setsScreens, 'BuilderScreen'),
  }),
  createRoute({
    ...at('/cart'),
    component: lazyRouteComponent(() => import('../screens/Cart'), 'Cart'),
  }),
  createRoute({
    ...at('/checkout'),
    // `?item=volume:<slug>:<ml>` and the like: «Купить сейчас», one item instead of the cart
    validateSearch: (s: Record<string, unknown>): { item?: string } =>
      typeof s.item === 'string' && parseBuyNowParam(s.item) ? { item: s.item } : {},
    component: lazyRouteComponent(() => import('../screens/Checkout'), 'Checkout'),
  }),
  createRoute({
    ...at('/orders'),
    component: lazyRouteComponent(() => import('../screens/Orders'), 'Orders'),
  }),
  createRoute({
    ...at('/orders/$number'),
    // an order number only; anything else lands on the list
    beforeLoad: ({ params }) => {
      if (!isOrderNumber(params.number)) throw redirect({ to: '/orders', replace: true });
    },
    component: lazyRouteComponent(() => import('../screens/Order'), 'Order'),
  }),
  createRoute({
    ...at('/orders/$number/pay'),
    beforeLoad: ({ params }) => {
      if (!isOrderNumber(params.number)) throw redirect({ to: '/orders', replace: true });
    },
    component: lazyRouteComponent(() => import('../screens/Payment'), 'Payment'),
  }),
  createRoute({
    ...at('/profile'),
    component: lazyRouteComponent(() => import('../screens/Profile'), 'Profile'),
  }),
  createRoute({
    ...at('/info/$slug'),
    component: lazyRouteComponent(() => import('../screens/InfoPage'), 'InfoPage'),
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
