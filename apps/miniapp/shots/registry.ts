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
  {
    // The seed has no hits and no Uzum links: a hit with the longest family and «Купить на Uzum».
    id: 'fragrance-hit-uzum',
    path: '/p/power-of-you',
    fullPage: true,
    setup: async ({ db }) => {
      await db.query(
        `update fragrances set is_hit = true, uzum_url = 'https://uzum.uz/ru/shop/lummi' where slug = $1`,
        ['power-of-you'],
      );
    },
    teardown: async ({ db }) => {
      await db.query(`update fragrances set is_hit = false, uzum_url = null where slug = $1`, [
        'power-of-you',
      ]);
    },
  },
  { id: 'fragrance-not-found', path: '/p/no-such-scent' },
  // The card on dev fixtures (src/dev/fragrance-fixtures.ts): the realistic worst case (long name
  // and brand, no family, every volume on sale, a seven-digit price, a missing photo), a fragrance
  // sold in one volume, and one with nothing optional (no volumes, notes or key notes).
  { id: 'fragrance-worst', path: '/dev/fragrance?data=worst', fullPage: true },
  { id: 'fragrance-one-volume', path: '/dev/fragrance?data=one', fullPage: true },
  { id: 'fragrance-empty', path: '/dev/fragrance?data=empty', fullPage: true },
  // Search (#16): suggestions while typing, the submitted result list, nothing found, a typo
  // («megamar» for Megamare), and a UZ note («zanjabil» is ginger), all on the seed catalog.
  { id: 'search-suggestions', path: '/search?q=bla' },
  { id: 'search-results', path: '/search?q=vanil&s=1', fullPage: true },
  { id: 'search-nothing-found', path: '/search?q=zzqx&s=1' },
  { id: 'search-typo', path: '/search?q=aventuss&s=1' },
  { id: 'search-uz-note', path: '/search?q=zanjabil&s=1' },
  { id: 'session-reopen', path: '/', initDataAgeSeconds: 3600 },
  // Dev-only component gallery (src/dev/Gallery.tsx): every base component in every state.
  { id: 'ui-gallery', path: '/dev/ui', fullPage: true },
  { id: 'ui-sheet', path: '/dev/sheet' },
];
