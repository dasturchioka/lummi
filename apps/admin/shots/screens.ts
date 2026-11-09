import { settingDefinitions } from '@lummi/contracts';
import type { AdminMessages } from '@lummi/i18n/admin';
import type { Page } from '@playwright/test';

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
  language: 'ru' | 'uz';
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
  { id: 'settings', path: '/settings', as: 'owner' },
  {
    id: 'settings-error',
    path: '/settings',
    as: 'owner',
    act: async ({ page, language }) => {
      // a fraction where a whole number of so'm is required, and an out-of-range number of seconds
      const threshold = page.getByLabel(
        settingDefinitions['pricing.freeDeliveryThreshold'].label[language],
        { exact: true },
      );
      await threshold.fill('250000.5');
      await threshold.press('Enter');
      await page.locator('[aria-invalid="true"]').first().waitFor();
      const ttl = page.getByLabel(settingDefinitions['auth.sessionTtlSeconds'].label[language], {
        exact: true,
      });
      await ttl.fill('5');
      await ttl.press('Enter');
      await page.locator('[aria-invalid="true"]').nth(1).waitFor();
    },
  },
  { id: 'audit', path: '/audit', as: 'owner' },
  {
    id: 'audit-filtered',
    path: '/audit',
    as: 'owner',
    act: async ({ page, t }) => {
      await page.getByLabel(t.audit.filters.actor).selectOption({ label: SHOT_STAFF[0]!.name });
      await page.getByLabel(t.audit.filters.action).selectOption('setting.changed');
      await page.getByLabel(t.audit.filters.from).fill('2026-01-01');
      await page
        .getByLabel(t.audit.filters.to)
        .fill(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' }));
      await page.getByRole('button', { name: t.audit.filters.apply }).click();
      await page.waitForURL(/action=setting\.changed/);
      await page.getByRole('link', { name: t.audit.filters.reset }).waitFor();
    },
  },
  { id: 'not-found', path: '/no-such-page', as: 'owner' },
  { id: 'not-found-guest', path: '/no-such-page' },
];
