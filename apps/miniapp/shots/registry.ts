import { SHOT_USER, signContact, type ApiClient } from './api';

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
  {
    id: 'profile',
    path: '/profile',
    // A customer who has shared the contact: Profile shows the account phone.
    setup: async ({ api }) => {
      const botToken = process.env.BOT_TOKEN ?? '';
      const res = await api.me.shareContact({
        body: { proof: signContact(botToken, SHOT_USER.id, '+998901234567') },
      });
      if (res.status !== 200) throw new Error(`profile shot: share contact failed ${res.status}`);
    },
  },
  { id: 'session-reopen', path: '/', initDataAgeSeconds: 3600 },
  // Dev-only component gallery (src/dev/Gallery.tsx): every base component in every state.
  { id: 'ui-gallery', path: '/dev/ui', fullPage: true },
  { id: 'ui-sheet', path: '/dev/sheet' },
  // The registration step (contact + write access), dev trigger in the gallery.
  { id: 'registration-sheet', path: '/dev/registration' },
];
