import type { ApiClient } from './api';

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
  setup?: (ctx: { api: ApiClient }) => Promise<void>;
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
  { id: 'session-reopen', path: '/', initDataAgeSeconds: 3600 },
  // Dev-only component gallery (src/dev/Gallery.tsx): every base component in every state.
  { id: 'ui-gallery', path: '/dev/ui', fullPage: true },
  { id: 'ui-sheet', path: '/dev/sheet' },
];
