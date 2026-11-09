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
  /** Viewport width in CSS px (default 390): 360 for the narrow Android check. */
  width?: number;
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

/** Empties the screenshot customer's cart, then adds the given volumes (slug, ml, qty). */
async function fillCart(api: ApiClient, items: [slug: string, ml: 10 | 30 | 50, qty?: number][]) {
  const now = await api.cart.get();
  if (now.status !== 200) throw new Error(`cart: HTTP ${now.status}`);
  for (const line of now.body.lines) await api.cart.removeLine({ params: { lineId: line.id } });
  for (const [slug, ml, qty = 1] of items) {
    const res = await api.cart.addLine({ body: { slug, ml, qty } });
    if (res.status !== 200) throw new Error(`add ${slug} ${ml}: HTTP ${res.status}`);
  }
}
const CART_SLUGS = ['symphony', 'tygar', 'ink-mark', 'power-of-you', 'baccarat-rouge-540'];
const emptyCart = async ({ api, db }: { api: ApiClient; db: ShotDb }) => {
  await fillCart(api, []);
  for (const slug of CART_SLUGS) await db.restore(slug);
};

/** Types a search and submits it, as the keyboard's «Найти» does. */
async function searchFor(page: Page, text: string) {
  const box = page.getByRole('searchbox');
  await box.fill(text);
  await box.press('Enter');
}

/** The dev fixture routes carry a data toggle; it is chrome, not part of the screen. */
const hideFixtureToggle = async ({ page }: { page: Page }) =>
  void (await page.addStyleTag({ content: 'nav[aria-label="fixture"] { display: none }' }));

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

/** Holds every catalog list request open, so the first load stays on its skeletons. */
const holdCatalog = async ({ page }: { page: Page }) => {
  await page.route('**/catalog/fragrances?*', () => undefined);
  await page.reload();
  await page.locator('[data-skeleton]').first().waitFor();
};
/** Fails every catalog list request, as a dropped connection does. */
const failCatalog = async ({ page }: { page: Page }) => {
  await page.route('**/catalog/fragrances?*', (route) => route.abort());
  await page.reload();
  await page.getByRole('button', { name: /Повторить|Qayta urinish/ }).waitFor();
};

/**
 * The realistic worst case through the data (break-ui): the longest brands of the guide pinned to
 * the top («Maison Francis Kurkdjian», «Boadicea the Victorious»), the longest name with a
 * seven-digit price, and a hit sold out in every volume.
 */
const WORST_HITS = [
  'elysium-pour-homme-parfum',
  'baccarat-rouge-540',
  'blue-sapphire',
  'miss-dior-blooming-bouquet',
];
const worstData: Pick<ScreenDef, 'setup' | 'teardown'> = {
  setup: async ({ db }) => {
    await db.query(`update fragrances set is_hit = true where slug = any($1)`, [WORST_HITS]);
    await db.query(`update fragrances set is_new = true where slug = 'baccarat-rouge-540'`);
    await db.query(
      `update volumes set price = case ml when 10 then 1250000 when 30 then 2450000 else 3490000 end
       where fragrance_id = (select id from fragrances where slug = 'elysium-pour-homme-parfum')`,
    );
    await db.setOnHand('blue-sapphire', 0);
  },
  teardown: async ({ db }) => {
    await unflagHome(db);
    // The seed's placeholder prices (one set for every fragrance).
    await db.query(
      `update volumes set price = case ml when 10 then 69000 when 30 then 149000 else 219000 end
       where fragrance_id = (select id from fragrances where slug = 'elysium-pour-homme-parfum')`,
    );
    await db.restore('blue-sapphire');
  },
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
  // The whole page: «Популярное» (no ХИТ badge: the title says it) and the «Новинки» rail.
  { id: 'home-full', path: '/', ...withFlags, fullPage: true },
  // A 360 px Android, the narrowest phone we build for.
  { id: 'home-360', path: '/', ...withFlags, width: 360, fullPage: true },
  { id: 'home-loading', path: '/', loading: true, act: holdCatalog },
  { id: 'home-error', path: '/', act: failCatalog },
  {
    // Nothing visible in the catalog yet: one calm state instead of empty sections.
    id: 'home-empty',
    path: '/',
    setup: async ({ db }) => void (await db.query(`update fragrances set hidden = true`)),
    teardown: async ({ db }) => void (await db.query(`update fragrances set hidden = false`)),
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
  {
    // The longest family name of the guide, chosen: the chip shows it.
    id: 'catalog-family-chosen',
    path: '/catalog',
    act: async ({ page }) => {
      await catalogSheet(/Семейство|Oila/)({ page });
      await sheet(page)
        .getByTestId('option-row')
        .filter({ hasText: /Древесно-цветочный мускусный|Yogʻochli gulli mushkli/ })
        .click();
      await sheet(page).waitFor({ state: 'detached' });
      await page
        .getByRole('button', { name: /Древесно-цветочный мускусный|Yogʻochli gulli mushkli/ })
        .waitFor();
    },
  },
  {
    // «Показать ещё»: the second page settles in under the first.
    id: 'catalog-more',
    path: '/catalog',
    act: async ({ page }) => {
      const cards = page.getByRole('list', { name: /^(Каталог|Katalog)$/ }).getByRole('listitem');
      await page.getByRole('button', { name: /Показать ещё|Yana koʻrsatish/ }).click();
      await cards.nth(24).waitFor();
      await cards.nth(22).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  { id: 'catalog-360', path: '/catalog', width: 360 },
  { id: 'catalog-worst-360', path: '/catalog', ...worstData, width: 360, fullPage: true },
  { id: 'catalog-sets', path: '/catalog?type=sets' },
  {
    // One fragrance sold out in every volume: its card says «Нет в наличии» in place of the price.
    id: 'catalog-sold-out',
    path: '/catalog',
    setup: async ({ db }) => db.setOnHand('symphony', 0),
    teardown: async ({ db }) => db.restore('symphony'),
    ...{ fullPage: true },
  },
  // A filter change keeps the old list (dimmed); the skeleton is the first load.
  { id: 'catalog-loading', path: '/catalog', loading: true, act: holdCatalog },
  { id: 'catalog-error', path: '/catalog?type=homme', act: failCatalog },
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
  // Cart (#18): lines with a stepper and a bin, the Sage thread, the dark totals block.
  {
    id: 'cart-lines',
    path: '/cart',
    fullPage: true,
    setup: async ({ api }) => {
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
    },
    teardown: emptyCart,
  },
  {
    id: 'cart-nudge',
    path: '/cart',
    fullPage: true,
    setup: async ({ api }) => {
      await forgetCity(api);
      // 218 000: a gap of 32 000, so 10 ml bottles can close it and the suggestions show.
      await fillCart(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
    },
    teardown: emptyCart,
  },
  {
    id: 'cart-sold-out',
    path: '/cart',
    fullPage: true,
    setup: async ({ api, db }) => {
      await chooseCity(api);
      await db.restore('power-of-you');
      await fillCart(api, [
        ['symphony', 10, 2],
        ['power-of-you', 10],
      ]);
      await db.setOnHand('power-of-you', 0);
    },
    teardown: emptyCart,
  },
  {
    id: 'cart-free-delivery',
    path: '/cart',
    fullPage: true,
    setup: async ({ api }) => {
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 30],
        ['tygar', 30],
      ]);
    },
    teardown: emptyCart,
  },
  // An applied discount and a line capped at what is left, on fixtures (no discount source exists yet).
  { id: 'cart-discount', path: '/dev/cart?data=discount', fullPage: true, act: hideFixtureToggle },
  { id: 'cart-empty', path: '/cart', setup: emptyCart },
  // The worst case on fixtures (src/dev/CartFixtures.tsx): twelve lines, a 40-character name,
  // quantity 99, a seven-digit total, the longest city. In the viewport, mid-scroll, the totals stay
  // above the tab bar while the lines run under them; the full page shows every line.
  {
    id: 'cart-worst',
    path: '/dev/cart?data=worst',
    act: async ({ page }) => {
      await hideFixtureToggle({ page });
      await page.evaluate(() => window.scrollTo(0, 700));
    },
  },
  { id: 'cart-worst-full', path: '/dev/cart?data=worst', fullPage: true, act: hideFixtureToggle },
  {
    id: 'cart-worst-nudge',
    path: '/dev/cart?data=worst-nudge',
    fullPage: true,
    act: hideFixtureToggle,
  },
  { id: 'cart-unavailable', path: '/dev/cart?data=unavailable', act: hideFixtureToggle },
  {
    // The cart request never answers: the cart's own skeleton.
    id: 'cart-loading',
    path: '/cart',
    setup: emptyCart,
    loading: true,
    act: async ({ page }) => {
      await page.route('**/api/cart*', () => undefined);
      await page.reload();
      await page.locator('[data-skeleton]').first().waitFor();
    },
  },
  {
    id: 'cart-error',
    path: '/cart',
    setup: emptyCart,
    act: async ({ page }) => {
      await page.route('**/api/cart*', (route) => route.abort());
      await page.reload();
      await page.getByRole('button', { name: /Повторить|Qayta urinish/ }).waitFor();
    },
  },
  // The fragrance card's dock once the volume is in the cart.
  {
    id: 'fragrance-in-cart',
    path: '/p/symphony',
    setup: ({ api }) => fillCart(api, [['symphony', 10]]),
    teardown: emptyCart,
  },
  {
    // «В корзину» once the last unit is already in the cart: the server caps it, «Осталось 1» shows.
    id: 'fragrance-capped',
    path: '/p/symphony',
    setup: async ({ api, db }) => {
      await db.setOnHand('symphony', 1);
      await fillCart(api, [['symphony', 10]]);
    },
    teardown: emptyCart,
    act: async ({ page }) => {
      await page.getByRole('button', { name: /В корзину|Savatga/ }).click();
      await page
        .getByRole('status')
        .filter({ hasText: /Осталось|Qoldi/ })
        .waitFor();
    },
  },
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
