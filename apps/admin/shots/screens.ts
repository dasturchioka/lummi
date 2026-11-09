import type { AdminMessages } from '@lummi/i18n/admin';
import type { Page } from '@playwright/test';
import { WORST_NAME } from './catalog-data';

/**
 * Opens a fragrance from the catalog list: the nth visible row (the seed gives the list a stable
 * order), or the one with this name. The list renders rows for phones and a table for wide
 * screens, so only the visible links count.
 */
async function openFragrance(page: Page, which: number | string = 0) {
  const link =
    typeof which === 'string'
      ? page.getByRole('link', { name: which, exact: true })
      : page
          .locator(
            'main a[href^="/catalog/"]:not([href="/catalog/dictionaries"]):not([href="/catalog/new"]):visible',
          )
          .nth(which);
  await link.first().click();
  await page.locator('form [data-volume]').first().waitFor();
}

/** Brings the volume editor to the top of the viewport (below the phone's top bar). */
async function scrollToVolumes(page: Page) {
  await page.locator('[data-volume="10"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

/** A photo upload the browser or the API refuses, captured with its message under the slot. */
function photoError(
  id: string,
  text: (t: AdminMessages) => string,
  file: { name: string; mimeType: string; buffer: Buffer },
): Screen {
  return {
    id,
    path: '/catalog',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await openFragrance(page);
      const slot = page.locator('[data-photo="10"]');
      await slot.locator('input[type=file]').setInputFiles(file);
      await slot.getByText(text(t)).waitFor();
      await slot.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
  };
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
  // Catalog (ticket #17). The shot run adds worst-case rows to the seeded 67 (see catalog-data.ts).
  { id: 'catalog', path: '/catalog', as: 'owner' },
  {
    id: 'catalog-filters',
    path: '/catalog',
    as: 'owner',
    widths: [390],
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.catalog.filters }).click();
      await page.locator('#f-flag').waitFor();
    },
  },
  { id: 'catalog-filtered', path: '/catalog?visibility=hidden&flag=hit', as: 'owner' },
  { id: 'catalog-empty', path: '/catalog?q=zzzzqqq', as: 'owner' },
  { id: 'catalog-new', path: '/catalog/new', as: 'owner' },
  {
    id: 'catalog-new-errors',
    path: '/catalog/new',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.catalog.save, exact: true }).click();
      await page.getByText(t.catalog.fixErrors).waitFor();
    },
  },
  {
    id: 'catalog-edit',
    path: '/catalog',
    as: 'owner',
    act: async ({ page }) => {
      await openFragrance(page);
    },
  },
  {
    id: 'catalog-edit-worst',
    path: '/catalog',
    as: 'owner',
    act: async ({ page }) => {
      await openFragrance(page, WORST_NAME);
    },
  },
  {
    id: 'catalog-volumes',
    path: '/catalog',
    as: 'owner',
    fullPage: false,
    act: async ({ page }) => {
      await openFragrance(page, WORST_NAME);
      await scrollToVolumes(page);
    },
  },
  {
    id: 'catalog-volume-errors',
    path: '/catalog',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await openFragrance(page);
      await page.locator('#f-sale-10').fill('999999');
      await page.locator('#f-end-30').fill('2026-12-31');
      await page.getByRole('button', { name: t.catalog.save, exact: true }).click();
      await page.getByText(t.catalog.fixErrors).waitFor();
      await scrollToVolumes(page);
    },
  },
  {
    id: 'catalog-on-hand-changed',
    path: '/catalog',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await openFragrance(page, 1);
      // a manager counts the 10 ml while the owner has the form open
      const id = new URL(page.url()).pathname.split('/').pop();
      const one = (await (
        await page.request.get(new URL(`/api/admin/catalog/fragrances/${id}`, page.url()).href)
      ).json()) as {
        volumes: { id: number; ml: number; onHand: number }[];
      };
      const v10 = one.volumes.find((v) => v.ml === 10)!;
      const res = await page.request.patch(
        new URL(`/api/admin/volumes/${v10.id}/on-hand`, page.url()).href,
        {
          data: { onHand: v10.onHand + 1 },
        },
      );
      if (!res.ok()) throw new Error(`on hand change failed: ${res.status()}`);
      await page.locator('#f-hand-10').fill(String(v10.onHand + 5));
      await page.getByRole('button', { name: t.catalog.save, exact: true }).click();
      await page.getByText(t.catalog.onHandChanged).waitFor();
      await scrollToVolumes(page);
    },
  },
  {
    id: 'catalog-below-reserve',
    path: '/catalog',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      // Reserves arrive with orders (a later ticket): stub 25 held on the first volume of the
      // editor's server payload, so the on hand of 20 shows the warning it will get then.
      await page.route(
        (url) => /^\/catalog\/\d+$/.test(url.pathname),
        async (route) => {
          if (route.request().headers()['rsc'] !== '1') return route.continue();
          const response = await route.fetch();
          const body = (await response.text()).replace('"reserved":0', '"reserved":25');
          await route.fulfill({ response, body });
        },
      );
      await openFragrance(page);
      await page.getByText(t.catalog.belowReserve).waitFor();
      await scrollToVolumes(page);
    },
  },
  {
    id: 'catalog-photo',
    path: '/catalog',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await openFragrance(page);
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
  photoError('catalog-photo-type', (t) => t.catalog.photoBadType, {
    name: 'photo.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('GIF89a'),
  }),
  photoError('catalog-photo-big', (t) => t.catalog.photoTooBig, {
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  }),
  // a real 1×1 PNG: the type and size pass, the server refuses the dimensions
  photoError('catalog-photo-small', (t) => t.catalog.photoTooSmall, {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    ),
  }),
  { id: 'catalog-dictionaries', path: '/catalog/dictionaries', as: 'owner' },
  {
    id: 'catalog-dictionaries-families',
    path: '/catalog/dictionaries',
    as: 'owner',
    act: async ({ page, t }) => {
      await page.getByRole('tab', { name: t.catalog.dict.families }).click();
      await page.getByRole('tab', { name: t.catalog.dict.families, selected: true }).waitFor();
    },
  },
  {
    id: 'catalog-dictionary-edit',
    path: '/catalog/dictionaries',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page
        .getByRole('button', { name: `${t.catalog.edit}: ` })
        .first()
        .click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'catalog-dictionary-taken',
    path: '/catalog/dictionaries',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      // the RU name is the unique key: give the first note the second one's, in either language
      const notes = (await (
        await page.request.get(new URL('/api/admin/catalog/notes', page.url()).href)
      ).json()) as { nameRu: string }[];
      await page
        .getByRole('button', { name: `${t.catalog.edit}: ` })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('#dict-ru').fill(notes[1]!.nameRu);
      await dialog.getByRole('button', { name: t.catalog.save, exact: true }).click();
      await dialog.getByText(t.catalog.dict.taken).waitFor();
    },
  },
  // BTS points (ticket #11). The shot run loads the committed snapshot first (see run.ts).
  { id: 'bts-points', path: '/bts-points', as: 'owner' },
  { id: 'bts-points-manager', path: '/bts-points', as: 'manager' },
  {
    id: 'bts-points-filtered',
    path: '/bts-points?region=3&status=active&q=%D0%B1%D0%BE%D0%B7%D0%BE%D1%80',
    as: 'owner',
  },
  { id: 'bts-points-empty', path: '/bts-points?q=zzzzqqq', as: 'manager' },
  {
    id: 'bts-point-add',
    path: '/bts-points',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.btsPoints.add }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'bts-point-edit',
    path: '/bts-points',
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      // the point's name is the editor's button («Изменить: <name>»)
      await page
        .getByRole('button', { name: `${t.btsPoints.edit}: ` })
        .first()
        .click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { id: 'bts-tariffs', path: '/bts-points/tariffs', as: 'owner' },
  {
    id: 'bts-tariff-edit',
    path: '/bts-points/tariffs',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.tariffs.edit, exact: true }).first().click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { id: 'not-found', path: '/no-such-page', as: 'owner' },
  { id: 'not-found-guest', path: '/no-such-page' },
];
