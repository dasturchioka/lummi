import { settingDefinitions } from '@lummi/contracts';
import type { AdminMessages } from '@lummi/i18n/admin';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { HYPHEN_NAME, WORST_NAME } from './catalog-data';
import { LIMIT_BANNER, LONG_PAGE } from './content-data';

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

/** A real bottle photo for the composer's image slot (kept in the repo under materials/). */
const BROADCAST_IMAGE = resolve(
  import.meta.dirname,
  '../../../materials/flakons/absolu-aventus_30ml.webp',
);

/** Fills both texts, picks the image and the «Каталог» button, as an owner about to send. */
async function fillComposer(page: Page, t: AdminMessages) {
  await page
    .locator('#bc-ru')
    .fill('Новый аромат уже в LUMMI. Откройте каталог и выберите свой вечер.');
  await page
    .locator('#bc-uz')
    .fill("LUMMI'da yangi atir bor. Katalogni oching va oʻz oqshomingizni tanlang.");
  await page.locator('[data-image] input[type=file]').setInputFiles(BROADCAST_IMAGE);
  await page.getByRole('button', { name: t.broadcasts.imageReplace }).waitFor();
  await page.locator('#bc-target').selectOption('catalog');
}

/** Opens a broadcast from the history: the nth row (newest first; the shot data makes the order stable). */
async function openBroadcast(page: Page, nth: number) {
  await page
    .locator('main a[href^="/broadcasts/"]:not([href="/broadcasts/new"]):visible')
    .nth(nth)
    .click();
  await page.locator('[data-count="sent"]').waitFor();
}

/*
 * Broadcast worst cases. Long copy is real copy repeated up to Telegram's limit; the big audience
 * enters through the API boundary (the panel's own `/api/admin/broadcasts…` calls are answered
 * with the real body and 50 420-sized counts), since the shot database holds 24 customers.
 */
const RU_SENTENCE =
  'Осень — время тёплых, древесных ароматов. В LUMMI появились новинки по мотивам Maison Francis Kurkdjian Baccarat Rouge 540 и Tom Ford Tobacco Vanille: густой шлейф, который остаётся с вами до вечера. ';
const RU_4096 = RU_SENTENCE.repeat(30).slice(0, 4096);
const UZ_LONG =
  'Kuz — iliq, yogʻochli iforlar fasli 🍂 LUMMIʼda Maison Francis Kurkdjian Baccarat Rouge 540 va Tom Ford Tobacco Vanille asosidagi yangiliklar paydo boʻldi: kechgacha siz bilan qoladigan quyuq iz. Oʻzingizga yoqqanini tanlang va doʻstlaringizga ulashing ✨ Toʻplamni sinab koʻring, sovgʻa uchun ham mos 🎁 '.repeat(
    5,
  );
/** Per audience, as the API answers it: everyone, the reachable ones, and those by language. */
const BIG_AUDIENCE = {
  all: { total: 51_977, reachable: 50_420, reachableByLanguage: { ru: 31_012, uz: 19_408 } },
  ru: { total: 32_101, reachable: 31_012, reachableByLanguage: { ru: 31_012, uz: 0 } },
  uz: { total: 19_876, reachable: 19_408, reachableByLanguage: { ru: 0, uz: 19_408 } },
};
const BIG_COUNTS = { total: 50_420, sent: 31_207, blocked: 1_913, failed: 12, pending: 17_288 };
const LONG_SLUG = 'velours-fume-extraordinaire-intense-rare';

/** Picks an audience in the composer and waits until its count is shown. */
async function pickAudience(page: Page, audience: 'all' | 'ru' | 'uz') {
  const counted = page.waitForResponse((r) => r.url().includes('/api/admin/broadcasts/audience'));
  await page.locator(`input[type=radio][value=${audience}]`).check();
  await counted;
  await page.locator('[data-audience-size] [aria-busy]').waitFor({ state: 'detached' });
}

/** Answers the composer's audience counts with 50 420 reachable customers for «all». */
async function showBigAudience(page: Page) {
  await page.route('**/api/admin/broadcasts/audience?**', (route) => {
    const audience = new URL(route.request().url()).searchParams.get('audience');
    const json = BIG_AUDIENCE[audience as keyof typeof BIG_AUDIENCE] ?? BIG_AUDIENCE.all;
    return route.fulfill({ status: 200, json });
  });
  // the page renders «all» counted by the server: count it again through the stub
  await pickAudience(page, 'ru');
  await pickAudience(page, 'all');
}

/** Types a fragrance slug as the button target and waits for its name to be looked up. */
async function typeFragranceTarget(page: Page, slug: string) {
  await page.locator('#bc-target').selectOption('fragrance');
  const looked = page.waitForResponse((r) => r.url().includes('/api/admin/broadcasts/fragrance'));
  await page.locator('#bc-slug').fill(slug);
  await looked;
  await page.locator('#bc-slug').blur();
  await page.waitForTimeout(100);
}

/**
 * Rewrites the running broadcast in the panel's polls (the detail every 2 s, the history every
 * 3 s): the real body with `patch` laid over it. Returns once the next poll has landed.
 */
async function patchRunningBroadcast(
  page: Page,
  scope: 'detail' | 'list',
  patch: Record<string, unknown>,
) {
  const url = scope === 'detail' ? /\/api\/admin\/broadcasts\/\d+$/ : /\/api\/admin\/broadcasts$/;
  await page.route(url, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { status: string } | { status: string }[];
    const over = (b: { status: string }) => (b.status === 'sending' ? { ...b, ...patch } : b);
    await route.fulfill({ response: res, json: Array.isArray(body) ? body.map(over) : over(body) });
  });
  await page.waitForResponse(url, { timeout: 10_000 });
  await page.waitForTimeout(150);
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
  language: 'ru' | 'uz';
  outsiderId: number;
  width: number;
};

/** The run's own shot database, for a state no admin form reaches without changing what later screens see. */
export type ShotSql = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

export type Screen = {
  /** File name prefix: `<id>-<width>-<lang>.png`. */
  id: string;
  path: string;
  /** Put the database in this screen's state before each capture… */
  setup?: (ctx: { db: ShotSql }) => Promise<void>;
  /** …and back again after it, so the next screen (and the next run) starts from the seed. */
  teardown?: (ctx: { db: ShotSql }) => Promise<void>;
  /** Who is signed in; omitted = nobody. */
  as?: 'owner' | 'manager';
  /** Defaults to 390 and 1280. */
  widths?: readonly number[];
  /** Interaction after load (open a dialog, submit a form). */
  act?: (ctx: ScreenContext) => Promise<void>;
  /** Full-page capture (default); overlays use the viewport. */
  fullPage?: boolean;
};

/*
 * The «Наборы» page at its worst (break-ui, #22): a fragrance hidden from the catalog (the shot
 * catalog's longest name) and the four longest names of the guide in the composition, a
 * seven-digit price still marked as a placeholder, and four-digit stock.
 */
let savedSet: { price: unknown; onHand: unknown; ids: unknown[] } | undefined;
const setsWorst: Pick<Screen, 'setup' | 'teardown'> = {
  setup: async ({ db }) => {
    const [set] = (await db.query('select price, on_hand from discovery_set')).rows;
    const items = await db.query('select fragrance_id from discovery_set_items order by position');
    savedSet ??= {
      price: set?.price,
      onHand: set?.on_hand,
      ids: items.rows.map((r) => r.fragrance_id),
    };
    await db.query(
      'update discovery_set set price = 1250000, on_hand = 1250, is_placeholder = true',
    );
    await db.query('delete from discovery_set_items');
    await db.query(
      `insert into discovery_set_items (position, fragrance_id)
       select 1, id from fragrances where name = $1
       union all
       select 1 + i, (select id from fragrances where slug = ($2::text[])[i])
       from generate_subscripts($2::text[], 1) as i`,
      [
        WORST_NAME,
        ['baccarat-rouge-540', 'blue-sapphire', 'le-male-le-parfum', 'pink-molecule-090-09'],
      ],
    );
  },
  teardown: async ({ db }) => {
    if (!savedSet) return;
    await db.query('update discovery_set set price = $1, on_hand = $2', [
      savedSet.price,
      savedSet.onHand,
    ]);
    await db.query('delete from discovery_set_items');
    await db.query(
      `insert into discovery_set_items (position, fragrance_id)
       select i, ($1::bigint[])[i] from generate_subscripts($1::bigint[], 1) as i`,
      [savedSet.ids],
    );
    savedSet = undefined;
  },
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
  // Settings and audit (ticket #9): owner only, so the manager's menu and sidebar lack both.
  {
    id: 'menu-manager',
    path: '/',
    as: 'manager',
    widths: [390],
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.nav.menu }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { id: 'settings', path: '/settings', as: 'owner' },
  {
    id: 'settings-system',
    path: '/settings',
    as: 'owner',
    fullPage: false,
    act: async ({ page }) => {
      await page.locator('#area-system').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  {
    id: 'settings-duration',
    path: '/settings',
    as: 'owner',
    fullPage: false,
    act: async ({ page }) => {
      // seconds read back as days and hours under the field («= 7 дней»)
      await page.locator('#area-auth').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  {
    id: 'settings-error',
    path: '/settings',
    as: 'owner',
    fullPage: false,
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
      await threshold.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
  },
  {
    id: 'settings-saving',
    path: '/settings',
    as: 'owner',
    fullPage: false,
    act: async ({ page, language }) => {
      // the save is held, so the row shows its pending state
      await page.route(/\/api\/admin\/settings\//, () => undefined);
      const label = settingDefinitions['pricing.freeDeliveryThreshold'].label[language];
      const field = page.getByLabel(label, { exact: true });
      await field.fill('275000');
      await field.press('Enter');
      await page.locator('form[aria-busy="true"] button[aria-busy="true"]').waitFor();
      await field.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
  },
  { id: 'audit', path: '/audit', as: 'owner' },
  {
    id: 'audit-filtered',
    path: '/audit',
    as: 'owner',
    act: async ({ page, t, width }) => {
      // phones keep the fields behind «Фильтры»
      if (width < 640) await page.getByRole('button', { name: t.audit.filters.toggle }).click();
      await page.getByLabel(t.audit.filters.actor).selectOption({ label: SHOT_STAFF[0]!.name });
      await page.getByLabel(t.audit.filters.action).selectOption('setting.changed');
      await page.getByLabel(t.audit.filters.from).fill('2026-01-01');
      await page
        .getByLabel(t.audit.filters.to)
        .fill(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' }));
      await page.getByRole('button', { name: t.audit.filters.apply }).click();
      await page.waitForURL(/action=setting\.changed/);
      await page.getByRole('link', { name: t.audit.filters.reset }).first().waitFor();
    },
  },
  {
    id: 'audit-details',
    path: '/audit?action=setting.changed',
    as: 'owner',
    fullPage: false,
    act: async ({ page }) => {
      await page.locator('summary:visible').first().click();
      const raw = page.locator('details[open] pre:visible').first();
      await raw.waitFor();
      await raw.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
  },
  // a staff member as the target is named like the actor
  { id: 'audit-staff', path: '/audit?action=staff.created', as: 'owner' },
  { id: 'audit-empty', path: '/audit?from=2020-01-01&to=2020-01-02', as: 'owner' },
  // Content (ticket #21): the banner editor with its live preview, the pages and the page editor.
  { id: 'content', path: '/content', as: 'owner' },
  {
    id: 'content-banner-editor',
    path: '/content',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.content.banner.edit }).first().click();
      await page.locator('[data-banner-preview]').waitFor();
      await page
        .locator('[data-banner-preview]')
        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  {
    id: 'content-banner-uz',
    path: '/content',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.content.banner.edit }).first().click();
      await page.getByRole('tab', { name: t.content.langUz }).click();
      await page
        .locator('[data-banner-preview]')
        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  { id: 'content-page-editor', path: '/content/pages/faq', as: 'owner' },
  { id: 'content-page-offer', path: '/content/pages/offer', as: 'owner' },
  // Worst cases (break-ui): a new banner typed to every field's limit, with its live preview; a
  // long page with the 80-character title typed into the editor (nothing is saved).
  {
    id: 'content-banner-limit',
    path: '/content',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t, language }) => {
      await page.getByRole('button', { name: t.content.banner.add }).click();
      const v = LIMIT_BANNER[language];
      await page.locator(`#bn-title-${language}`).fill(v.title);
      await page.locator(`#bn-sub-${language}`).fill(v.subtitle);
      await page.locator(`#bn-price-${language}`).fill(v.priceLine);
      await page
        .locator('[data-banner-preview]')
        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  {
    id: 'content-page-long',
    path: '/content/pages/about',
    as: 'owner',
    act: async ({ page, language }) => {
      const v = LONG_PAGE[language];
      await page.locator('#page-title').fill(v.title);
      await page.locator('#page-body').fill(v.body);
      // filling scrolls the field into view; the capture starts at the top like the others
      await page.evaluate(() => window.scrollTo(0, 0));
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
  // Sets (#22): the Discovery set's stock, price, composition and photo.
  { id: 'sets', path: '/sets', as: 'owner' },
  { id: 'sets-manager', path: '/sets', as: 'manager' },
  {
    // The same fragrance picked twice: the second field says so and «Сохранить» stays off.
    id: 'sets-duplicate',
    path: '/sets',
    as: 'owner',
    act: async ({ page, t }) => {
      const first = page.locator('#set-pick-0');
      const value = await first.inputValue();
      await page.locator('#set-pick-1').selectOption(value);
      await page.getByText(t.sets.duplicate).waitFor();
    },
  },
  { id: 'sets-worst', path: '/sets', as: 'owner', ...setsWorst },
  { id: 'sets-manager-worst', path: '/sets', as: 'manager', ...setsWorst },
  { id: 'catalog-dictionaries', path: '/catalog/dictionaries', as: 'owner' },
  {
    id: 'catalog-dictionaries-search',
    path: '/catalog/dictionaries',
    as: 'owner',
    act: async ({ page, t }) => {
      await page.getByRole('searchbox', { name: t.catalog.search }).fill("d'");
      await page.getByRole('button', { name: t.catalog.apply, exact: true }).click();
      await page.getByRole('button', { name: t.catalog.reset }).waitFor();
    },
  },
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
  // Broadcasts (ticket #14). The shot data is written to the database (broadcast-data.ts); nothing is sent to Telegram.
  { id: 'broadcasts', path: '/broadcasts', as: 'owner' },
  { id: 'broadcast-new', path: '/broadcasts/new', as: 'owner' },
  {
    id: 'broadcast-new-filled',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page, t }) => {
      await fillComposer(page, t);
    },
  },
  {
    id: 'broadcast-new-errors',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.broadcasts.send, exact: true }).click();
      await page.getByText(t.broadcasts.fixErrors).waitFor();
    },
  },
  {
    id: 'broadcast-new-caption',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page, t }) => {
      await fillComposer(page, t);
      await page.locator('#bc-ru').fill('Тёплый вечер. '.repeat(90));
      await page.locator('#bc-uz').fill('Iliq oqshom. '.repeat(90));
      await page.getByRole('button', { name: t.broadcasts.send, exact: true }).click();
      await page.getByText(t.broadcasts.errors.captionTooLong).first().waitFor();
    },
  },
  {
    id: 'broadcast-new-warnings',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page, t }) => {
      await page.locator('#bc-ru').fill('Копия известного аромата 🎉🎉🎉 за копейки.');
      await page.getByText(t.broadcasts.warnings.title).waitFor();
    },
  },
  {
    id: 'broadcast-test-sent',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page, t }) => {
      // the shot owner has no real Telegram chat: the answer is stubbed, so nothing reaches Telegram
      await page.route('**/api/admin/broadcasts/test', (route) =>
        route.fulfill({ status: 200, json: { sent: ['ru', 'uz'] } }),
      );
      await fillComposer(page, t);
      await page.getByRole('button', { name: t.broadcasts.sendTest }).click();
      await page.getByText(t.broadcasts.testSent).waitFor();
    },
  },
  {
    id: 'broadcast-send-confirm',
    path: '/broadcasts/new',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await fillComposer(page, t);
      await page.getByRole('button', { name: t.broadcasts.send, exact: true }).click();
      await page.getByRole('alertdialog').waitFor();
    },
  },
  {
    id: 'broadcast-running',
    path: '/broadcasts',
    as: 'owner',
    act: async ({ page }) => {
      await openBroadcast(page, 0);
    },
  },
  {
    id: 'broadcast-done',
    path: '/broadcasts',
    as: 'owner',
    act: async ({ page }) => {
      await openBroadcast(page, 1);
    },
  },
  {
    id: 'broadcast-new-target',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page }) => {
      await page
        .locator('#bc-ru')
        .fill('Absolu Aventus снова в наличии. Свежий, дымный, уверенный: аромат для важного дня.');
      await page
        .locator('#bc-uz')
        .fill('Absolu Aventus yana sotuvda. Yangi, tutunli, ishonchli: muhim kun uchun ifor.');
      await typeFragranceTarget(page, 'absolu-aventus');
    },
  },
  {
    id: 'broadcast-new-target-missing',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page, t }) => {
      await fillComposer(page, t);
      await typeFragranceTarget(page, 'absolu-aventus-intense');
    },
  },
  {
    // a UZ-only audience locks the preview to UZ, even right after the RU text was edited
    id: 'broadcast-new-locked',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page, t }) => {
      await fillComposer(page, t);
      await pickAudience(page, 'uz');
      await page.locator('#bc-ru').focus();
    },
  },
  {
    // a warning still open at confirm time is repeated in the sheet (it warns, never blocks)
    id: 'broadcast-send-confirm-warnings',
    path: '/broadcasts/new',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await fillComposer(page, t);
      await page
        .locator('#bc-ru')
        .fill('Не копия, а аромат по мотивам Creed Aventus 🎉🎉🎉 для вашего вечера.');
      await page.getByRole('button', { name: t.broadcasts.send, exact: true }).click();
      await page.getByRole('alertdialog').waitFor();
    },
  },
  ...(['ru', 'uz'] as const).map((audience): Screen => ({
    id: `broadcast-send-confirm-${audience}`,
    path: '/broadcasts/new',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await fillComposer(page, t);
      await pickAudience(page, audience);
      await page.getByRole('button', { name: t.broadcasts.send, exact: true }).click();
      await page.getByRole('alertdialog').waitFor();
    },
  })),
  // Broadcast worst cases (captured into shots/14/worst-case/).
  {
    id: 'w-text-4096',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page }) => {
      await page.locator('#bc-ru').fill(RU_4096);
      await page.locator('#bc-uz').fill('Qisqa matn.');
      await page.locator('#bc-ru').focus();
    },
  },
  {
    id: 'w-uz-long',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page, t }) => {
      await page.locator('#bc-ru').fill('Короткий текст.');
      await page.locator('#bc-uz').fill(UZ_LONG);
      await page.getByText(t.broadcasts.warnings.title).waitFor();
    },
  },
  {
    id: 'w-recipients-50420-composer',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page }) => {
      await showBigAudience(page);
    },
  },
  {
    id: 'w-recipients-50420-confirm',
    path: '/broadcasts/new',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await fillComposer(page, t);
      await showBigAudience(page);
      await page.getByRole('button', { name: t.broadcasts.send, exact: true }).click();
      await page.getByRole('alertdialog').waitFor();
    },
  },
  {
    id: 'w-recipients-50420-detail',
    path: '/broadcasts',
    as: 'owner',
    act: async ({ page }) => {
      await openBroadcast(page, 0);
      await patchRunningBroadcast(page, 'detail', { counts: BIG_COUNTS });
    },
  },
  {
    id: 'w-recipients-50420-list',
    path: '/broadcasts',
    as: 'owner',
    act: async ({ page }) => {
      await patchRunningBroadcast(page, 'list', { counts: BIG_COUNTS });
    },
  },
  {
    id: 'w-target-long-composer',
    path: '/broadcasts/new',
    as: 'owner',
    act: async ({ page, t }) => {
      await fillComposer(page, t);
      await typeFragranceTarget(page, LONG_SLUG);
    },
  },
  {
    id: 'w-target-long-detail',
    path: '/broadcasts',
    as: 'owner',
    act: async ({ page }) => {
      await openBroadcast(page, 0);
      await patchRunningBroadcast(page, 'detail', {
        buttonTarget: `p_${LONG_SLUG}`,
        buttonFragrance: HYPHEN_NAME,
      });
    },
  },
  { id: 'not-found', path: '/no-such-page', as: 'owner' },
  { id: 'not-found-guest', path: '/no-such-page' },
];
