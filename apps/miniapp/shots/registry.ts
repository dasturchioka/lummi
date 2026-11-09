import type { Page } from '@playwright/test';
import { signContact } from '@lummi/contracts/sign-contact';
import { SHOT_USER, type ApiClient, type ShotUser } from './api';
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
  /** Interact with the loaded page (open a sheet, type in a search) before the capture. */
  act?: (ctx: { page: Page }) => Promise<void>;
  /** Capture the loading state `act` left on screen: skeletons are expected, not waited out. */
  loading?: boolean;
  /** Sign in with initData this many seconds old (shows the "reopen the app" state). */
  initDataAgeSeconds?: number;
  /** Capture the whole scrolling page instead of the 390x844 viewport. */
  fullPage?: boolean;
  /** Take this screen as another customer (default `SHOT_USER`), e.g. one who never shared a phone. */
  user?: ShotUser;
}

/** Saves the screenshot customer's delivery city (needs `npm run bts:import` to have run). */
async function chooseCity(api: ApiClient, regionCode = 'Самаркандская', city = 'Самарканд') {
  const regions = await api.delivery.regions();
  if (regions.status !== 200) throw new Error(`regions: HTTP ${regions.status}`);
  const region = regions.body.find((r) => r.nameRu.startsWith(regionCode));
  if (!region) throw new Error(`no region "${regionCode}"`);
  const saved = await api.me.setDeliveryCity({ body: { regionId: region.id, city } });
  if (saved.status !== 200) throw new Error(`delivery city: HTTP ${saved.status} (run bts:import)`);
}
const forgetCity = async (api: ApiClient) => void (await api.me.clearDeliveryCity());

const sheet = (page: Page) => page.getByRole('dialog');
async function openCitySheet(page: Page) {
  await page.getByTestId('delivery-row').click();
  await sheet(page).waitFor();
}
/** Taps the n-th region row of the open sheet. */
async function pickRegion(page: Page, n: number) {
  await sheet(page).getByTestId('region-row').nth(n).click();
  await sheet(page).getByTestId('city-row').first().waitFor();
}
async function pickCityRow(page: Page, text: string) {
  await sheet(page).getByTestId('city-row').filter({ hasText: text }).first().click();
  await sheet(page).getByTestId('point-row').first().waitFor();
}

/** Types a search and submits it, as the keyboard's «Найти» does. */
async function searchFor(page: Page, text: string) {
  const box = page.getByRole('searchbox');
  await box.fill(text);
  await box.press('Enter');
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

/** The seed has no hits and no new flags: pin three hits and flag six novelties for Home and the catalog. */
const HITS = ['symphony', 'aventus', 'tygar'];
const NEWS = [
  'althair',
  'power-of-you',
  'ink-mark',
  'rain-tea',
  'safran-secret',
  'baccarat-rouge-540',
];
async function flagHome(db: ShotDb) {
  await db.query(`update fragrances set is_hit = true where slug = any($1)`, [HITS]);
  await db.query(`update fragrances set is_new = true where slug = any($1)`, [NEWS]);
}
async function unflagHome(db: ShotDb) {
  await db.query(`update fragrances set is_hit = false, is_new = false`);
}
const withFlags: Pick<ScreenDef, 'setup' | 'teardown'> = {
  setup: ({ db }) => flagHome(db),
  teardown: ({ db }) => unflagHome(db),
};
const catalogSheet =
  (name: RegExp): NonNullable<ScreenDef['act']> =>
  async ({ page }) => {
    await page.getByRole('button', { name }).first().click();
    await sheet(page).waitFor();
    await sheet(page).getByTestId('option-row').first().waitFor();
  };

export const screens: ScreenDef[] = [
  {
    id: 'home',
    path: '/',
    setup: async ({ api, db }) => {
      await forgetCity(api);
      await flagHome(db);
    },
    teardown: ({ db }) => unflagHome(db),
  },
  // Home with the delivery city chosen, and the sheet that changes it.
  {
    id: 'home-delivery',
    path: '/',
    setup: async ({ api, db }) => {
      await chooseCity(api);
      await flagHome(db);
    },
    teardown: ({ db }) => unflagHome(db),
  },
  {
    // «Популярное» with a chip selected: it filters in place.
    id: 'home-popular-femme',
    path: '/',
    ...withFlags,
    act: async ({ page }) => {
      await page.getByRole('radio', { name: 'Femme' }).click();
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-skeleton]') &&
          !document.querySelector('[aria-busy="true"]'),
      );
    },
  },
  {
    id: 'delivery-regions',
    path: '/',
    setup: ({ api }) => forgetCity(api),
    act: async ({ page }) => {
      await openCitySheet(page);
      await sheet(page).getByTestId('region-row').first().waitFor();
    },
  },
  {
    id: 'delivery-cities',
    path: '/',
    setup: ({ api }) => forgetCity(api),
    act: async ({ page }) => {
      await openCitySheet(page);
      await pickRegion(page, 2); // Samarkand region
    },
  },
  {
    id: 'delivery-city-selected',
    path: '/',
    setup: ({ api }) => chooseCity(api),
    act: async ({ page }) => {
      await openCitySheet(page); // opens on the saved city's region
      await sheet(page).getByTestId('city-row').first().waitFor();
    },
  },
  // The point picker (checkout embeds it), hosted by the dev-only route.
  {
    id: 'delivery-point-regions',
    path: '/dev/delivery',
    act: async ({ page }) => void (await sheet(page).getByTestId('region-row').first().waitFor()),
  },
  {
    id: 'delivery-point-cities',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
    },
  },
  {
    id: 'delivery-points',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
    },
  },
  {
    id: 'delivery-point-search',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await sheet(page).getByRole('searchbox').fill('чилонзар');
      await sheet(page).getByTestId('point-row').first().waitFor();
    },
  },
  {
    id: 'delivery-point-typed',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
      await sheet(page)
        .locator('button.type-button, button')
        .filter({ hasText: /Нет вашего пункта|Punktingiz yoʻqmi/ })
        .click();
      await sheet(page).getByRole('textbox').waitFor();
    },
  },
  {
    id: 'delivery-point-noresults',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await sheet(page).getByRole('searchbox').fill('qwerty');
      await sheet(page)
        .getByRole('heading', { name: /Ничего не нашли|Hech narsa topilmadi/ })
        .waitFor();
    },
  },
  {
    // the end of a city's list: the way into the typed address
    id: 'delivery-points-end',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
      await sheet(page).evaluate((dialog) => {
        const body = [...dialog.querySelectorAll('div')].find(
          (d) => getComputedStyle(d).overflowY === 'auto',
        );
        if (body) body.scrollTop = body.scrollHeight;
      });
    },
  },
  {
    // reopened on a saved point: the picker opens on its city, the row marked and in view
    id: 'delivery-point-selected',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
      await sheet(page).getByTestId('point-row').nth(6).click();
      await sheet(page).waitFor({ state: 'detached' });
      await page.getByRole('button', { name: /Сменить|Oʻzgartirish/ }).click();
      await sheet(page).locator('[data-testid="point-row"][aria-pressed="true"]').waitFor();
    },
  },
  {
    // checkout's collapsed choice (#23 embeds it): name, address · hours, «Сменить», the city count
    id: 'delivery-point-card',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
      await sheet(page).getByTestId('point-row').nth(6).click();
      await sheet(page).waitFor({ state: 'detached' });
      await page
        .getByTestId('chosen-point')
        .getByText(/ещё|yana/)
        .waitFor();
    },
  },
  // Catalog (#15): the default, each filter sheet, the sort, a combination, and the states.
  { id: 'catalog', path: '/catalog', fullPage: true },
  { id: 'catalog-sheet-family', path: '/catalog', act: catalogSheet(/Семейство|Oila/) },
  { id: 'catalog-sheet-volume', path: '/catalog', act: catalogSheet(/Объём|Hajm/) },
  { id: 'catalog-sheet-season', path: '/catalog', act: catalogSheet(/Сезон|Mavsum/) },
  {
    id: 'catalog-sheet-price',
    path: '/catalog',
    act: async ({ page }) => {
      await page
        .getByRole('button', { name: /Цена|Narx/ })
        .first()
        .click();
      await sheet(page).getByRole('textbox').first().waitFor();
    },
  },
  {
    id: 'catalog-sheet-sort',
    path: '/catalog',
    act: async ({ page }) => {
      await page.getByRole('button', { name: /Топ продаж|Koʻp sotilganlar/ }).click();
      await sheet(page).getByTestId('option-row').first().waitFor();
    },
  },
  { id: 'catalog-sort-price-asc', path: '/catalog?sort=price_asc', fullPage: true },
  { id: 'catalog-sort-new', path: '/catalog?sort=new', ...withFlags, fullPage: true },
  {
    id: 'catalog-filtered',
    path: '/catalog?type=femme&volume=30&season=autumn_winter&min=100000&max=200000',
    fullPage: true,
  },
  { id: 'catalog-nothing-found', path: '/catalog?min=9000000' },
  { id: 'catalog-sets', path: '/catalog?type=sets' },
  {
    // One fragrance sold out in every volume: its card says «Нет в наличии» in place of the price.
    id: 'catalog-sold-out',
    path: '/catalog',
    setup: async ({ db }) => db.setOnHand('symphony', 0),
    teardown: async ({ db }) => db.restore('symphony'),
    ...{ fullPage: true },
  },
  {
    id: 'catalog-loading',
    path: '/catalog',
    loading: true,
    act: async ({ page }) => {
      // A filter change keeps the old list (dimmed); the skeleton is the first load.
      await page.route('**/catalog/fragrances?*', () => undefined);
      await page.reload();
      await page.locator('[data-skeleton]').first().waitFor();
    },
  },
  {
    id: 'catalog-error',
    path: '/catalog?type=homme',
    act: async ({ page }) => {
      await page.route('**/catalog/fragrances?*', (route) => route.abort());
      await page.reload();
      await page.getByRole('button', { name: /Повторить|Qayta urinish/ }).waitFor();
    },
  },
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
  {
    // «Похожие ароматы» at the foot of the card (the curated ones, then the same family and type).
    id: 'fragrance-similar',
    path: '/p/symphony',
    act: async ({ page }) => {
      const heading = page.getByRole('heading', { name: /Похожие ароматы|Oʻxshash iforlar/ });
      await heading.waitFor();
      await page.locator('[data-skeleton]').first().waitFor({ state: 'detached' });
      await heading.scrollIntoViewIfNeeded();
      await heading.evaluate((h) => h.scrollIntoView({ block: 'start' }));
    },
  },
  // The card on dev fixtures (src/dev/fragrance-fixtures.ts): the realistic worst case (long name
  // and brand, no family, every volume on sale, a seven-digit price, a missing photo), a fragrance
  // sold in one volume, and one with nothing optional (no volumes, notes or key notes).
  { id: 'fragrance-worst', path: '/dev/fragrance?data=worst', fullPage: true },
  { id: 'fragrance-one-volume', path: '/dev/fragrance?data=one', fullPage: true },
  { id: 'fragrance-empty', path: '/dev/fragrance?data=empty', fullPage: true },
  // Search (#16): the empty field with its hint, suggestions while typing (the fifth is the
  // longest attribution, Boadicea the Victorious), the submitted result list, the 30-result cap
  // («ambra»), nothing found, a typo («aventuss»), a UZ note («zanjabil» is ginger), a long UZ
  // query, all on the seed catalog; then loading, error and the keyboard-shrunk viewport.
  { id: 'search-hint', path: '/search' },
  { id: 'search-suggestions', path: '/search?q=bla' },
  { id: 'search-results', path: '/search?q=vanil&s=1', fullPage: true },
  { id: 'search-results-30', path: '/search?q=ambra&s=1', fullPage: true },
  { id: 'search-nothing-found', path: '/search?q=zzqx&s=1' },
  { id: 'search-typo', path: '/search?q=aventuss&s=1' },
  { id: 'search-uz-note', path: '/search?q=zanjabil&s=1' },
  {
    id: 'search-long-query',
    path: `/search?q=${encodeURIComponent('kechqurun kiyiladigan yogʻochli ziravorli iforlar')}&s=1`,
  },
  {
    // The request never answers: the result cards' skeleton.
    id: 'search-loading',
    path: '/search',
    loading: true,
    act: async ({ page }) => {
      await page.route('**/catalog/search*', () => undefined);
      await searchFor(page, 'vanil');
      await page.locator('[data-skeleton]').first().waitFor();
    },
  },
  {
    id: 'search-suggest-loading',
    path: '/search',
    loading: true,
    act: async ({ page }) => {
      await page.route('**/catalog/suggest*', () => undefined);
      await page.getByRole('searchbox').fill('bla');
      await page.locator('[data-skeleton]').first().waitFor();
    },
  },
  {
    // The request fails (and its one retry): the error with «Повторить».
    id: 'search-error',
    path: '/search',
    act: async ({ page }) => {
      await page.route('**/catalog/search*', (route) => route.abort());
      await searchFor(page, 'vanil');
      await page.getByRole('button', { name: /Повторить|Qayta urinish/ }).waitFor();
    },
  },
  {
    // The keyboard is up: Telegram shrinks the viewport, the list scrolls under the field.
    id: 'search-keyboard',
    path: '/search?q=bla',
    act: async ({ page }) => {
      await page.getByRole('searchbox').focus();
      await page.setViewportSize({ width: 390, height: 480 });
      await page.evaluate(() => window.scrollBy(0, 160));
    },
  },
  // FragranceListCard on dev fixtures: grid (the catalog's), row and compact, worst cases included.
  { id: 'list-cards', path: '/dev/list', fullPage: true },
  { id: 'session-reopen', path: '/', initDataAgeSeconds: 3600 },
  // Dev-only component gallery (src/dev/Gallery.tsx): every base component in every state.
  { id: 'ui-gallery', path: '/dev/ui', fullPage: true },
  { id: 'ui-sheet', path: '/dev/sheet' },
  // The registration step (contact + write access); its dev trigger is in the gallery.
  ...registrationStates,
];
