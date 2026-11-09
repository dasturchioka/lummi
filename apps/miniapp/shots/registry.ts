import { signContact } from '@lummi/contracts/sign-contact';
import { SHOT_USER, type ApiClient, type ShotUser } from './api';

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
  /** Take this screen as another customer (default `SHOT_USER`), e.g. one who never shared a phone. */
  user?: ShotUser;
}

/** A customer who has not shared the contact yet (Profile shows the «Добавить» row). */
const NO_PHONE_USER: ShotUser = {
  id: 700_000_002,
  first_name: 'Javohir',
  username: 'javohir_t',
  language_code: 'uz',
};

/** Every state of the registration sheet, on its dev route (no Telegram call). */
const registrationStates: ScreenDef[] = (
  [
    ['initial', 'idle'],
    ['waiting', 'busy'],
    ['done', 'done&bot=1'],
    ['done-in-app', 'done&bot=0'],
    ['denied', 'denied'],
    ['failed', 'failed'],
    ['foreign', 'foreign'],
    ['expired', 'expired'],
    ['taken', 'taken'],
    ['update-telegram', 'unsupported'],
    ['browser', 'browser'],
  ] as const
).map(([id, state]) => ({ id: `registration-${id}`, path: `/dev/registration?state=${state}` }));

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
        body: {
          proof: signContact({
            botToken,
            userId: SHOT_USER.id,
            phone: '+998901234567',
            authDate: Math.floor(Date.now() / 1000),
          }),
        },
      });
      if (res.status !== 200) throw new Error(`profile shot: share contact failed ${res.status}`);
    },
  },
  { id: 'profile-no-phone', path: '/profile', user: NO_PHONE_USER },
  { id: 'session-reopen', path: '/', initDataAgeSeconds: 3600 },
  // Dev-only component gallery (src/dev/Gallery.tsx): every base component in every state.
  { id: 'ui-gallery', path: '/dev/ui', fullPage: true },
  { id: 'ui-sheet', path: '/dev/sheet' },
  // The registration step (contact + write access); its dev trigger is in the gallery.
  ...registrationStates,
];
