import type { AdminMessages } from '@lummi/i18n/admin';
import type { Page } from '@playwright/test';

/** Opens the first fragrance of the catalog list (the seed gives the list a stable first row). */
async function openFirstFragrance(page: Page) {
  await page
    .locator('a[href^="/catalog/"]:not([href="/catalog/dictionaries"]):not([href="/catalog/new"])')
    .first()
    .click();
  await page.locator('form [data-volume]').first().waitFor();
}

/** Shot staff live under reserved Telegram ids, so they never collide with real dev accounts. */
export type ShotStaff = {
  telegramId: number;
  name: string;
  role: 'owner' | 'manager';
  active: boolean;
};
export const SHOT_STAFF: ShotStaff[] = [
  { telegramId: 990000001, name: 'Fayzali Joʻramaxamadov', role: 'owner', active: true },
  { telegramId: 990000002, name: 'Dilnoza Karimova', role: 'manager', active: true },
  {
    telegramId: 990000003,
    name: 'Abdurahmonov Muhammadjon Saidakbar oʻgʻli',
    role: 'manager',
    active: true,
  },
  { telegramId: 990000004, name: 'Jasur Toshmatov', role: 'manager', active: false },
];
/** A Telegram account that is not on staff: signs in to the «Нет доступа» state. */
export const OUTSIDER_ID = 990000099;

export type ScreenContext = {
  page: Page;
  t: AdminMessages;
  outsiderId: number;
  width: number;
};

export type Screen = {
  /** File name prefix: `<id>-<width>-<lang>.png`. */
  id: string;
  path: string;
  /** Who is signed in; omitted = nobody. */
  as?: 'owner' | 'manager';
  /** Defaults to 390 and 1280. */
  widths?: readonly number[];
  /** Interaction after load (open a dialog, submit a form). */
  act?: (ctx: ScreenContext) => Promise<void>;
  /** Full-page capture (default); overlays use the viewport. */
  fullPage?: boolean;
};

export const screens: Screen[] = [
  { id: 'login', path: '/login' },
  {
    id: 'no-access',
    path: '/login',
    act: async ({ page, t, outsiderId }) => {
      await page.getByLabel(t.login.devTelegramId).fill(String(outsiderId));
      await page.getByRole('button', { name: t.login.devSubmit }).click();
      await page.getByText(t.errors.noAccess, { exact: true }).waitFor();
    },
  },
  { id: 'home', path: '/', as: 'owner' },
  { id: 'home-manager', path: '/', as: 'manager' },
  {
    id: 'menu',
    path: '/',
    as: 'owner',
    widths: [390],
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.nav.menu }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { id: 'staff', path: '/staff', as: 'owner' },
  {
    id: 'staff-add',
    path: '/staff',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.staff.add }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'staff-deactivate',
    path: '/staff',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.staff.deactivate, exact: true }).first().click();
      await page.getByRole('alertdialog').waitFor();
    },
  },
  {
    id: 'staff-remove',
    path: '/staff',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.staff.remove, exact: true }).first().click();
      await page.getByRole('alertdialog').waitFor();
    },
  },
  { id: 'catalog', path: '/catalog', as: 'owner' },
  {
    id: 'catalog-edit',
    path: '/catalog',
    as: 'owner',
    act: async ({ page }) => {
      await openFirstFragrance(page);
    },
  },
  {
    id: 'catalog-volumes',
    path: '/catalog',
    as: 'owner',
    fullPage: false,
    act: async ({ page }) => {
      await openFirstFragrance(page);
      await page.locator('[data-volume="10"]').scrollIntoViewIfNeeded();
      await page
        .locator('[data-volume="10"]')
        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  {
    id: 'catalog-photo',
    path: '/catalog',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await openFirstFragrance(page);
      const slot = page.locator('[data-photo="10"]');
      const src = await slot.locator('img').getAttribute('src');
      // upload the fragrance's own picture again (a larger rendition), so no photo is swapped for a stranger
      const bytes = await (
        await page.request.get(new URL((src ?? '').replace('-400.', '-1200.'), page.url()).href)
      ).body();
      await slot
        .locator('input[type=file]')
        .setInputFiles({ name: 'photo.webp', mimeType: 'image/webp', buffer: bytes });
      await slot.getByText(t.catalog.photoUploaded).waitFor();
      await slot.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
  },
  { id: 'catalog-dictionaries', path: '/catalog/dictionaries', as: 'owner' },
  {
    id: 'catalog-dictionary-edit',
    path: '/catalog/dictionaries',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.catalog.edit, exact: false }).first().click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { id: 'not-found', path: '/no-such-page', as: 'owner' },
  { id: 'not-found-guest', path: '/no-such-page' },
];
