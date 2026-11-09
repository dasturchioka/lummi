import type { ApiClient } from './api';
import type { ShotDb } from './db';

/**
 * Every screen the screenshot run captures, in one place. Each UI ticket adds its screens here
 * (and a `setup` when the screen needs state, such as an item already in the cart).
 *
 * `path` is a real route of the app. Theme and language are NOT set here: the run saves them
 * through PATCH /me/preferences for each light/dark x RU/UZ combination, like the app does.
 */
export interface ScreenDef {
  /** File name stem: `<id>-<theme>-<lang>.png`. kebab-case. */
  id: string;
  path: string;
  /** Prepare server state for this screen, as the signed-in screenshot customer. */
  setup?: (ctx: { api: ApiClient; db: ShotDb }) => Promise<void>;
  /** Undo what `setup` changed in the database, so the next run starts from the seed. */
  teardown?: (ctx: { api: ApiClient; db: ShotDb }) => Promise<void>;
  /** Sign in with initData this many seconds old (shows the "reopen the app" state). */
  initDataAgeSeconds?: number;
  /** Capture the whole scrolling page instead of the 390x844 viewport. */
  fullPage?: boolean;
}

export const screens: ScreenDef[] = [
  { id: 'home', path: '/' },
  { id: 'catalog', path: '/catalog' },
  { id: 'cart', path: '/cart' },
  { id: 'orders', path: '/orders' },
  { id: 'profile', path: '/profile' },
  // Fragrance card (#8): the seed catalog, real fragrances. The long ones stress the lockup.
  { id: 'fragrance', path: '/p/symphony', fullPage: true },
  { id: 'fragrance-long-name', path: '/p/elysium-pour-homme-parfum', fullPage: true },
  { id: 'fragrance-long-brand', path: '/p/baccarat-rouge-540', fullPage: true },
  {
    // The seed has no markdown: put one on the 10 ml bottle of Tygar (the volume the card opens on).
    id: 'fragrance-sale',
    path: '/p/tygar',
    fullPage: true,
    setup: async ({ db }) => db.markdown('tygar', 10, 55_200, 5),
    teardown: async ({ db }) => db.restore('tygar'),
  },
  {
    // Every volume sold out: the card still opens and says so.
    id: 'fragrance-sold-out',
    path: '/p/ink-mark',
    fullPage: true,
    setup: async ({ db }) => db.setOnHand('ink-mark', 0),
    teardown: async ({ db }) => db.restore('ink-mark'),
  },
  { id: 'fragrance-not-found', path: '/p/no-such-scent' },
  { id: 'session-reopen', path: '/', initDataAgeSeconds: 3600 },
  // Dev-only component gallery (src/dev/Gallery.tsx): every base component in every state.
  { id: 'ui-gallery', path: '/dev/ui', fullPage: true },
  { id: 'ui-sheet', path: '/dev/sheet' },
];
