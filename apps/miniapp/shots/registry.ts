import type { Page } from '@playwright/test';
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
  /** Interact with the loaded page (open a sheet, type in a search) before the capture. */
  act?: (ctx: { page: Page }) => Promise<void>;
  /** Sign in with initData this many seconds old (shows the "reopen the app" state). */
  initDataAgeSeconds?: number;
  /** Capture the whole scrolling page instead of the 390x844 viewport. */
  fullPage?: boolean;
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

export const screens: ScreenDef[] = [
  { id: 'home', path: '/', setup: ({ api }) => forgetCity(api) },
  // Home with the delivery city chosen, and the sheet that changes it.
  { id: 'home-delivery', path: '/', setup: ({ api }) => chooseCity(api) },
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
        .filter({ hasText: /Не нашёл|topa olmadim/ })
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
      await page.getByTestId('picked').click();
      await sheet(page).locator('[data-testid="point-row"][aria-pressed="true"]').waitFor();
    },
  },
  { id: 'catalog', path: '/catalog' },
  { id: 'cart', path: '/cart' },
  { id: 'orders', path: '/orders' },
  { id: 'profile', path: '/profile' },
  { id: 'session-reopen', path: '/', initDataAgeSeconds: 3600 },
  // Dev-only component gallery (src/dev/Gallery.tsx): every base component in every state.
  { id: 'ui-gallery', path: '/dev/ui', fullPage: true },
  { id: 'ui-sheet', path: '/dev/sheet' },
];
