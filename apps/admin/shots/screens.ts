import { BOARD_STATUSES, settingDefinitions, type AdminHome } from '@lummi/contracts';
import { fill } from '@lummi/i18n';
import type { AdminMessages } from '@lummi/i18n/admin';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { HYPHEN_NAME, WORST_NAME } from './catalog-data';
import { LIMIT_BANNER, LONG_PAGE } from './content-data';
import { SHOT_QR_CODE, WORST_LINK_CODE } from './campaign-data';
import { customerScreens, stockScreens } from './stock-data';
import {
  forgetPromoList,
  forgetUses,
  holdUses,
  seedPromoList,
  WORST_PROMO,
  WORST_FIXED_PROMO,
} from './promo-data';
import {
  forgetCoupons,
  forgetWorst,
  seedShotCoupons,
  seedWorstCoupons,
  seedWorstRequests,
} from './not-delivered-data';
import { shotMarketing } from './marketing-data';
import { SHOT_ORDER } from './orders-data';
import { boardCrowd, boardCrowdBack, boardDay, boardDayBack } from './board-data';
import { cardBack, homeDay, homeDayBack, humoBack, humoSilent, noCard } from './home-data';
import { EARLIER_CARD, SHOT_CARD } from './shop-card-data';

/**
 * The native `<select>` behind a dropdown (#47): the field itself on a touch pointer, the hidden
 * source of truth next to the Radix trigger on a fine one. Picking through it fires the same
 * `change` the popover does.
 */
function nativeSelect(loc: Locator) {
  return loc.locator('xpath=self::select | self::button/parent::div/select').first();
}
/** Opens a dropdown's list; a click that lands before hydration is retried. */
async function openList(page: Page, field: Locator) {
  for (let i = 0; i < 4; i++) {
    await field.click();
    if (await page.getByRole('listbox').isVisible().catch(() => false)) return;
    await page.waitForTimeout(400);
  }
  await page.getByRole('listbox').waitFor();
}
async function choose(loc: Locator, option: string | { label: string }) {
  await nativeSelect(loc).selectOption(option, { force: true });
}

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

/**
 * A full-page capture of an order page waits for every receipt image to decode, and scrolls
 * through once: a phone viewport paints an image below the fold only after it was in view.
 */
async function imagesLoaded({ page }: { page: Page }) {
  await page.waitForFunction(() =>
    [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  );
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
}

/** Presses a button on the order page and waits for the dialog it opens. */
async function openOrderDialog(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  return dialog;
}

/** Exactly 500 characters, the most a return's reason takes (`TYPED_REASON_MAX`). */
const LONGEST_RETURN_REASON =
  'Покупательница вернула всю посылку через пункт BTS: коробка пришла мятой, два флакона по 50 мл протекли в дороге и залили остальные, на трёх флаконах по 30 мл стёрлись этикетки, а флаконы по 10 мл вскрыли. Целыми и в заводской плёнке остались только пять позиций, их можно продать снова. Остальное списать после осмотра, фото повреждений в чате заказов. Деньги вернуть на ту же карту Humo, с которой пришла оплата, после согласования с владельцем; покупательницу предупредили, она согласна подождать.';

/** «Оформить возврат товара» on the twelve-line worst case: five lines flagged, the longest reason. */
async function worstReturnDialog({ page, t }: ScreenContext) {
  const dialog = await openOrderDialog(page, t.orders.ret.action);
  const lines = dialog.locator('[data-return-line] input');
  for (const i of [0, 2, 5, 8, 11]) await lines.nth(i).check();
  await dialog.locator('textarea').fill(LONGEST_RETURN_REASON);
  // typing scrolled the form: start from its title
  await dialog.evaluate((el) => el.scrollTo(0, 0));
  return dialog;
}

/** Brings the volume editor to the top of the viewport (below the phone's top bar). */
async function scrollToVolumes(page: Page) {
  await page.locator('[data-volume="10"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

/**
 * Puts the shot card back (a save that changes nothing writes nothing) or takes it off, through
 * the owner's same-origin API, then reloads: the page reads the card on the server.
 */
async function shopCard(page: Page, card: { number: string; holder: string } | null) {
  const url = `${new URL(page.url()).origin}/api/admin/shop-card`;
  const res = card ? await page.request.put(url, { data: card }) : await page.request.delete(url);
  if (res.status() !== 200) throw new Error(`shop card ${card ? 'set' : 'clear'}: ${res.status()}`);
  await page.reload({ waitUntil: 'networkidle' });
}

/** Opens «Изменить» on the shot card and types another number (the holder stays). */
async function editCard(page: Page, t: AdminMessages, number?: string) {
  await shopCard(page, SHOT_CARD);
  await page.getByRole('button', { name: t.shopCard.edit, exact: true }).click();
  await page.getByRole('dialog').waitFor();
  if (number !== undefined) await page.getByLabel(t.shopCard.number).fill(number);
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

/** The current catalog export, opened for editing (the owner's session rides on `page.request`). */
async function exportWorkbook(page: Page, edit: (wb: ExcelJS.Workbook) => void) {
  const bytes = await (
    await page.request.get(new URL('/api/admin/catalog/export', page.url()).href)
  ).body();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  edit(wb);
  return {
    name: 'LUMMI_Katalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  };
}
const cell = (ws: ExcelJS.Worksheet, row: number, header: string) => {
  let col = 0;
  ws.getRow(1).eachCell((c, n) => {
    if (c.text === header) col = n;
  });
  return ws.getRow(row).getCell(col);
};

/** Prices are changed by the «applied» shot; the run puts them back for the screens after it. */
const importRestore: Pick<Screen, 'setup' | 'teardown'> = {
  setup: async ({ db }) => {
    await db.query('drop table if exists shot_volume_backup');
    await db.query('create table shot_volume_backup as select id, price from volumes');
  },
  teardown: async ({ db }) => {
    await db.query(
      'update volumes v set price = b.price from shot_volume_backup b where b.id = v.id',
    );
    await db.query('drop table if exists shot_volume_backup');
  },
};

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
  await choose(page.locator('#bc-target'), 'catalog');
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
  await choose(page.locator('#bc-target'), 'fragrance');
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

/**
 * Shot staff live under reserved Telegram ids, so they never collide with real dev accounts. A
 * member without a Telegram id has not linked one yet and signs in with the password (#50);
 * `temporary` is still on the owner's temporary password.
 */
export type ShotStaff = {
  telegramId: number | null;
  login: string;
  name: string;
  role: 'owner' | 'manager';
  active: boolean;
  temporary?: boolean;
};
/** Every shot member's password: dev data for the throwaway shots database, not a secret. */
export const SHOT_PASSWORD = 'Shot-pass-2026';
export const SHOT_STAFF: ShotStaff[] = [
  {
    telegramId: 990000001,
    login: 'fayzali',
    name: 'Fayzali Joʻramaxamadov',
    role: 'owner',
    active: true,
  },
  {
    telegramId: 990000002,
    login: 'dilnoza',
    name: 'Dilnoza Karimova',
    role: 'manager',
    active: true,
  },
  {
    telegramId: 990000003,
    login: 'muhammadjon.abdurahmonov',
    name: 'Abdurahmonov Muhammadjon Saidakbar oʻgʻli',
    role: 'manager',
    active: true,
  },
  {
    telegramId: 990000004,
    login: 'jasur',
    name: 'Jasur Toshmatov',
    role: 'manager',
    active: false,
  },
  { telegramId: null, login: 'malika', name: 'Malika Yusupova', role: 'manager', active: true },
  {
    telegramId: null,
    login: 'bekzod',
    name: 'Bekzod Rahimov',
    role: 'manager',
    active: true,
    temporary: true,
  },
];
/** Who a screen signs in as (`Screen.as`). */
export function shotMember(as: NonNullable<Screen['as']>): ShotStaff {
  const pick = (f: (s: ShotStaff) => boolean) => SHOT_STAFF.find(f) as ShotStaff;
  if (as === 'owner') return pick((s) => s.role === 'owner');
  if (as === 'unlinked') return pick((s) => s.telegramId === null && !s.temporary);
  if (as === 'temporary') return pick((s) => !!s.temporary);
  return pick((s) => s.role === 'manager' && s.telegramId !== null && s.active);
}
const SHOT_REFUND_REASON = 'shot: reports';
/** A 30 000 refund of the delivered shot order 9012, sent on 10 November (the sales report). */
async function shotRefund(db: ShotSql, what: 'add' | 'remove') {
  await db.query(`delete from refunds where reason = $1`, [SHOT_REFUND_REASON]);
  if (what === 'remove') return;
  await db.query(
    `insert into refunds (order_id, amount, refunded_on, reason, staff_id)
     select o.id, 30000, '2026-11-10', $1, (select min(id) from staff) from orders o where o.number = $2`,
    [SHOT_REFUND_REASON, SHOT_ORDER.deliveredMany],
  );
}

/**
 * Order 9003's receipt held for a person as if the AI had confirmed it with a credit staff marked
 * «Не для заказа» while it answered (#49), or back to the seed's «ИИ не смог подтвердить».
 */
async function creditMarkedReceipt(db: ShotSql, on: boolean) {
  const held = `select r.id from receipts r join orders o on o.id = r.order_id
    where o.number = $1 and r.verdict = 'manual_review'`;
  await db.query(`update receipts set review_reason = $2 where id in (${held})`, [
    SHOT_ORDER.review,
    on ? 'credit_marked' : 'not_confirmed',
  ]);
  // the AI's answer: sure, choosing the first credit it was shown; or the seed's unsure one
  const answer = on
    ? { isReceipt: 0.98, amountMatches: 0.96, recipientMatches: 0.95, choiceConfidence: 0.78 }
    : { isReceipt: 0.97, amountMatches: 0.55, recipientMatches: 0.91, choiceConfidence: 0.42 };
  await db.query(
    `update receipt_checks set outcome = $2,
       judgement = $3::jsonb || jsonb_build_object(
         'confirmed', $4::boolean,
         'chosenCreditId', case when $4::boolean then candidate_credit_ids[1] end,
         'provider', 'typesafe')
         || case when $4::boolean then '{}'::jsonb else '{"reason": "below threshold"}'::jsonb end
     where receipt_id in (${held})`,
    [SHOT_ORDER.review, on ? 'credit_taken' : 'manual_review', JSON.stringify(answer), on],
  );
}

/** The Home's shot day, plus a state that takes the Now slot; undone in reverse after each shot. */
function homeOn(extra?: 'humo' | 'noCard'): Pick<Screen, 'setup' | 'teardown'> {
  return {
    setup: async ({ db }) => {
      await homeDay(db);
      if (extra === 'humo') await humoSilent(db);
      if (extra === 'noCard') await noCard(db);
    },
    teardown: async ({ db }) => {
      if (extra === 'humo') await humoBack(db);
      if (extra === 'noCard') await cardBack(db);
      await homeDayBack(db);
    },
  };
}

/** The Home has answered: its Now block is drawn. */
async function homeLoaded({ page }: ScreenContext) {
  await page.locator('[data-now]').waitFor();
}

/** A Telegram account that is not on staff: signs in to the «Нет доступа» state. */
export const OUTSIDER_ID = 990000099;

export type ScreenContext = {
  page: Page;
  t: AdminMessages;
  language: 'ru' | 'uz';
  outsiderId: number;
  width: number;
  /** The shot database, for a change that has to land while the page is open (a race). */
  db: ShotSql;
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
  /**
   * Who is signed in; omitted = nobody. `unlinked`: a manager without Telegram (signs in with the
   * password); `temporary`: one still on a temporary password.
   */
  as?: 'owner' | 'manager' | 'unlinked' | 'temporary';
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

/** Fills the sign-in form and presses «Войти» (the dev form's button has its own label). */
async function passwordSignIn(page: Page, t: AdminMessages, login: string, password: string) {
  await page.getByLabel(t.login.login, { exact: true }).fill(login);
  await page.getByLabel(t.login.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: t.login.submit, exact: true }).click();
}
/** Wrong passwords and locks the sign-in screens leave behind. */
async function clearThrottles({ db }: { db: ShotSql }) {
  await db.query('delete from login_throttles');
}
/** A temporary password typed in for the shots (the dialogs generate a random one). */
const SHOT_TEMPORARY = 'k7Pm4QxR2vNa9sTe';
/** The manager «Добавить менеджера» adds in its shot, removed again around it. */
const SHOT_NEWCOMER = { name: 'Sevara Aliyeva', login: 'sevara.aliyeva' };
async function removeShotNewcomer({ db }: { db: ShotSql }) {
  await db.query('delete from staff where login = $1', [SHOT_NEWCOMER.login]);
}
/** «Сбросить пароль» on the long-named manager, in whichever layout the width shows. */
const RESET_TARGET = SHOT_STAFF[2]!;
function resetButton(page: Page, t: AdminMessages) {
  return page
    .locator('main li:visible, main tr:visible')
    .filter({ hasText: RESET_TARGET.name })
    .getByRole('button', { name: t.staff.resetPassword, exact: true });
}

/** A normal day on the orders board (#52): the Home's day and a dozen fresh orders (board-data.ts). */
const boardOn: Pick<Screen, 'setup' | 'teardown'> = {
  setup: ({ db }) => boardDay(db),
  teardown: ({ db }) => boardDayBack(db),
};

/** The board has answered: its columns hold cards. */
async function boardLoaded({ page }: ScreenContext) {
  await page.locator('[data-board]:not([aria-busy])').waitFor();
  await page.locator('[data-order]').first().waitFor();
}

/** Scrolls the board so the order's column starts at the left edge, and returns the card. */
async function boardCard(page: Page, number: number) {
  const card = page.locator(`[data-order="${number}"]`);
  await card.waitFor();
  await card.evaluate((el) =>
    el.closest('[data-column]')?.scrollIntoView({ inline: 'start', block: 'nearest' }),
  );
  await page.waitForTimeout(150);
  return card;
}

/**
 * Picks the order up with the mouse and carries it over `to`'s column, held there: the lifted
 * card, its empty slot, the target's drop slot naming the move, the columns it cannot go to
 * dimmed. On a phone the target only peeks in: the card is held at the edge until the board has
 * scrolled it into view, as a thumb would.
 */
async function carry(page: Page, number: number, to: string) {
  const card = await boardCard(page, number);
  const from = await card.boundingBox();
  if (!from) throw new Error(`no card ${number}`);
  const x = from.x + from.width / 2;
  const y = from.y + 24;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 4, { steps: 3 });
  const target = page.locator(`[data-column="${to}"], [data-rail="${to}"]`).first();
  const width = page.viewportSize()!.width;
  let box = await target.boundingBox();
  if (!box || box.x + box.width > width) {
    await page.mouse.move(width - 4, y + 40, { steps: 8 });
    await page
      .waitForFunction(
        ([selector, right]) => {
          const r = document.querySelector(selector as string)?.getBoundingClientRect();
          return Boolean(r && r.right <= (right as number));
        },
        [`[data-column="${to}"]`, width],
        { timeout: 6000 },
      )
      .catch(() => undefined);
    box = await target.boundingBox();
  }
  if (!box) throw new Error(`no column ${to}`);
  await page.mouse.move(box.x + Math.min(box.width / 2, 72), y + 40, { steps: 10 });
  await page.locator('[data-over]').first().waitFor();
  await page.waitForTimeout(250);
}

/** Every column empty, as a shop without orders sees it. */
async function emptyBoard({ page }: ScreenContext) {
  await page.route('**/api/admin/orders/board**', (route) =>
    route.fulfill({
      json: {
        at: new Date().toISOString(),
        recentDays: 14,
        limit: 50,
        shopHasOrders: false,
        columns: BOARD_STATUSES.map((status) => ({ status, count: 0, sum: 0, cards: [] })),
      },
    }),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-empty-slot]').waitFor();
}

export const screens: Screen[] = [
  { id: 'login', path: '/login' },
  {
    id: 'no-access',
    path: '/login',
    act: async ({ page, t, outsiderId }) => {
      await page.getByLabel(t.login.devTelegramId).fill(String(outsiderId));
      await page.getByRole('button', { name: t.login.devSubmit, exact: true }).click();
      await page.getByText(t.errors.noAccess, { exact: true }).waitFor();
    },
  },
  // ---- Home (#48): the work queue over a normal shot day, then each state that takes the Now slot
  { id: 'home', path: '/', as: 'owner', ...homeOn(), act: homeLoaded },
  { id: 'home-manager', path: '/', as: 'manager', ...homeOn(), act: homeLoaded },
  { id: 'home-humo', path: '/', as: 'owner', ...homeOn('humo'), act: homeLoaded },
  { id: 'home-no-card', path: '/', as: 'owner', ...homeOn('noCard'), act: homeLoaded },
  { id: 'home-no-card-manager', path: '/', as: 'manager', ...homeOn('noCard'), act: homeLoaded },
  {
    id: 'home-clear',
    path: '/',
    as: 'owner',
    ...homeOn(),
    // nothing waits: the day's answer with every queue empty (the shot orders stay for other screens)
    act: async ({ page, t }) => {
      await page.route('**/api/admin/home', async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as AdminHome;
        const empty = { count: 0, since: null, waitedSeconds: null };
        await route.fulfill({
          response: res,
          json: {
            ...body,
            now: { kind: 'clear' },
            queues: {
              receipts: empty,
              accept: empty,
              assemble: empty,
              bts: empty,
              credits: { ...empty, oldestAmountTiyin: null },
              refunds: empty,
              stock: { count: 0, out: 0, low: 0, first: null },
              reviews: empty,
            },
          },
        });
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByText(t.home.now.clear.title, { exact: true }).waitFor();
    },
  },
  {
    id: 'home-loading',
    path: '/',
    as: 'owner',
    // the first answer never comes: the skeleton
    act: async ({ page }) => {
      await page.route('**/api/admin/home', () => undefined);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('[aria-busy="true"] .skeleton').first().waitFor();
    },
  },
  {
    id: 'home-error',
    path: '/',
    as: 'owner',
    act: async ({ page, t }) => {
      await page.route('**/api/admin/home', (route) =>
        route.fulfill({ status: 500, json: { code: 'internal' } }),
      );
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByText(t.home.error.title, { exact: true }).waitFor();
    },
  },
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
  // Sign-in by login and password, staff accounts, the profile (#50, ADR 0038)
  {
    id: 'login-wrong',
    path: '/login',
    teardown: clearThrottles,
    act: async ({ page, t }) => {
      await passwordSignIn(page, t, 'dilnoza', 'not-the-password');
      await page.getByText(t.errors.invalidCredentials, { exact: true }).waitFor();
    },
  },
  {
    id: 'login-locked',
    path: '/login',
    setup: async ({ db }) => {
      await db.query(
        `insert into login_throttles (scope, key, failures, window_started_at, locked_until)
         values ('login', 'dilnoza', 0, now(), now() + interval '15 minutes')
         on conflict (scope, key) do update set locked_until = excluded.locked_until`,
      );
    },
    teardown: clearThrottles,
    act: async ({ page, t }) => {
      await passwordSignIn(page, t, 'dilnoza', SHOT_PASSWORD);
      await page.getByText(t.errors.locked, { exact: true }).waitFor();
    },
  },
  { id: 'change-password', path: '/', as: 'temporary' },
  {
    id: 'change-password-errors',
    path: '/',
    as: 'temporary',
    act: async ({ page, t }) => {
      await page.getByLabel(t.changePassword.newPassword, { exact: true }).fill('short');
      await page.getByRole('button', { name: t.changePassword.submit }).click();
      await page.getByText(fill(t.errors.weakPassword, { min: '8' })).waitFor();
    },
  },
  { id: 'profile', path: '/profile', as: 'unlinked' },
  {
    id: 'profile-link',
    path: '/profile',
    as: 'unlinked',
    teardown: async ({ db }) => {
      await db.query(
        `delete from staff_telegram_links where staff_id = (select id from staff where login = 'malika')`,
      );
    },
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.profile.link, exact: true }).click();
      await page.getByText(t.profile.linkWaiting).waitFor();
    },
  },
  { id: 'profile-linked', path: '/profile', as: 'manager' },
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
    id: 'staff-added',
    path: '/staff',
    as: 'owner',
    fullPage: false,
    setup: removeShotNewcomer,
    teardown: removeShotNewcomer,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.staff.add }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(t.staff.name).fill(SHOT_NEWCOMER.name);
      await dialog.getByLabel(t.staff.login).fill(SHOT_NEWCOMER.login);
      await dialog.getByLabel(t.staff.password).fill(SHOT_TEMPORARY);
      await dialog.getByRole('button', { name: t.staff.addSubmit, exact: true }).click();
      await dialog.getByText(t.staff.addedTitle, { exact: true }).waitFor();
    },
  },
  {
    id: 'staff-reset',
    path: '/staff',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await resetButton(page, t).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'staff-reset-done',
    path: '/staff',
    as: 'owner',
    fullPage: false,
    // the reset left that manager on a temporary password: put them back
    teardown: async ({ db }) => {
      await db.query(`update staff set must_change_password = false where login = $1`, [
        RESET_TARGET.login,
      ]);
    },
    act: async ({ page, t }) => {
      await resetButton(page, t).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(t.staff.password).fill(SHOT_TEMPORARY);
      await dialog.getByRole('button', { name: t.staff.resetSubmit, exact: true }).click();
      await dialog.getByText(t.staff.resetDoneTitle, { exact: true }).waitFor();
    },
  },
  {
    id: 'staff-unlink',
    path: '/staff',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('button', { name: t.staff.unlink, exact: true }).first().click();
      await page.getByRole('alertdialog').waitFor();
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
    // #30: the birthday coupon's settings, after the promo-code ones in «Цены и скидки»
    id: 'settings-birthday',
    path: '/settings',
    as: 'owner',
    fullPage: false,
    act: async ({ page, language }) => {
      await page
        .getByLabel(settingDefinitions['birthday.percent'].label[language], { exact: true })
        .evaluate((el) => el.closest('form')?.scrollIntoView({ block: 'start' }));
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
      await choose(page.getByLabel(t.audit.filters.actor), { label: SHOT_STAFF[0]!.name });
      await choose(page.getByLabel(t.audit.filters.action), 'setting.changed');
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
  // Promo codes (ticket #29): the list, the editor of the worst-case code, a new code with every
  // error, the delete dialog, and the audit entries.
  { id: 'promo-list', path: '/promo-codes', as: 'owner' },
  {
    id: 'promo-editor',
    path: '/promo-codes',
    as: 'owner',
    act: async ({ page }) => {
      await page.getByRole('link', { name: WORST_PROMO, exact: true }).first().click();
      await page.locator('#p-code').waitFor();
    },
  },
  { id: 'promo-new', path: '/promo-codes/new', as: 'owner' },
  {
    id: 'promo-new-errors',
    path: '/promo-codes/new',
    as: 'owner',
    act: async ({ page, t }) => {
      await page.locator('#p-code').fill('ЛУММИ');
      await page.locator('#p-percent').fill('120');
      await page.getByRole('button', { name: t.promo.save, exact: true }).click();
      await page.getByText(t.promo.fixErrors, { exact: true }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  {
    id: 'promo-remove',
    path: '/promo-codes',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.getByRole('link', { name: 'LUMMI10', exact: true }).first().click();
      await page.getByRole('button', { name: t.promo.remove, exact: true }).click();
      await page.getByRole('alertdialog').waitFor();
    },
  },
  {
    // a code orders have used: the count, and the note in place of «Удалить»
    id: 'promo-used',
    path: '/promo-codes',
    as: 'owner',
    setup: ({ db }) => holdUses(db, 'MINUS50', 12),
    act: async ({ page }) => {
      await page.getByRole('link', { name: 'MINUS50', exact: true }).first().click();
      await page.locator('#p-code').waitFor();
    },
    teardown: ({ db }) => forgetUses(db),
  },
  {
    // an order takes the code while its editor is open: the delete is refused, «only switch it off»
    id: 'promo-remove-refused',
    path: '/promo-codes',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t, db }) => {
      await page.getByRole('link', { name: 'LUMMI10', exact: true }).first().click();
      await page.locator('#p-code').waitFor();
      await holdUses(db, 'LUMMI10', 1);
      await page.getByRole('button', { name: t.promo.remove, exact: true }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: t.promo.remove, exact: true })
        .click();
      await page.getByText(t.promo.inUse, { exact: true }).waitFor();
    },
    teardown: ({ db }) => forgetUses(db),
  },
  // Campaign links (ticket #35): the list, the editor of a hand-made link, a new link, and the QR.
  { id: 'campaign-list', path: '/campaign-links', as: 'owner' },
  {
    id: 'campaign-editor',
    path: '/campaign-links',
    as: 'owner',
    act: async ({ page }) => {
      await page.getByRole('link', { name: SHOT_QR_CODE, exact: true }).first().click();
      await page.locator('#c-code').waitFor();
    },
  },
  { id: 'campaign-new', path: '/campaign-links/new', as: 'owner' },
  {
    id: 'campaign-qr',
    path: '/campaign-links',
    as: 'owner',
    act: async ({ page }) => {
      await page.getByRole('link', { name: SHOT_QR_CODE, exact: true }).first().click();
      const qr = page.locator('img[src*="/qr"]');
      await qr.waitFor();
      await page.waitForFunction(() => {
        const img = document.querySelector<HTMLImageElement>('img[src*="/qr"]');
        return !!img && img.complete && img.naturalWidth > 0;
      });
      await qr.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
  },
  {
    // the 40-character code and the longest label, on the list's row
    id: 'campaign-editor-worst',
    path: '/campaign-links',
    as: 'owner',
    act: async ({ page }) => {
      await page.getByRole('link', { name: WORST_LINK_CODE, exact: true }).first().click();
      await page.locator('#c-code').waitFor();
    },
  },
  { id: 'promo-audit', path: '/audit?action=promo.created', as: 'owner' },
  // break-ui (#29), captured into shots/29/worst-case/: sixty codes in every state, and the editor
  // of a seven-digit fixed code with every condition (the 32-character percent code is promo-editor).
  {
    id: 'promo-list-worst',
    path: '/promo-codes',
    as: 'owner',
    setup: ({ db }) => seedPromoList(db),
    teardown: ({ db }) => forgetPromoList(db),
  },
  {
    id: 'promo-editor-fixed-worst',
    path: '/promo-codes',
    as: 'owner',
    act: async ({ page }) => {
      await page.getByRole('link', { name: WORST_FIXED_PROMO, exact: true }).first().click();
      await page.locator('#p-code').waitFor();
    },
  },
  // «Карта для оплаты» (ticket #28): owner only. No card first, so the card is back for the rest.
  {
    id: 'shop-card-none',
    path: '/shop-card',
    as: 'owner',
    act: async ({ page, t }) => {
      await shopCard(page, null);
      await page.getByText(t.shopCard.noneTitle, { exact: true }).waitFor();
    },
  },
  {
    id: 'shop-card',
    path: '/shop-card',
    as: 'owner',
    act: async ({ page }) => {
      await shopCard(page, SHOT_CARD);
      await page.getByTestId('shop-card').waitFor();
    },
  },
  {
    id: 'shop-card-edit',
    path: '/shop-card',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => editCard(page, t),
  },
  {
    id: 'shop-card-invalid',
    path: '/shop-card',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      // fifteen digits and no holder
      await editCard(page, t, '8600 3104 7725 905');
      await page.getByLabel(t.shopCard.holder).fill('');
      await page.getByRole('button', { name: t.shopCard.next }).click();
      await page.locator('[aria-invalid="true"]').nth(1).waitFor();
    },
  },
  {
    id: 'shop-card-confirm',
    path: '/shop-card',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await editCard(page, t, '8600310477259055');
      await page.getByRole('button', { name: t.shopCard.next }).click();
      await page.getByTestId('confirm-number').waitFor();
    },
  },
  {
    id: 'shop-card-typo',
    path: '/shop-card',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      // one digit off: the check digit says so, the save stays possible
      await editCard(page, t, '8600 3104 7725 9065');
      await page.getByRole('button', { name: t.shopCard.next }).click();
      await page.getByText(t.shopCard.checksum).waitFor();
    },
  },
  {
    // break-ui (#28): a 30-character holder on the confirm step, with the check-digit warning
    id: 'shop-card-worst',
    path: '/shop-card',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await editCard(page, t, '8600 3104 7725 9065');
      await page.getByLabel(t.shopCard.holder).fill('MUHAMMADSODIQXON ABDURAHMONOVA');
      await page.getByRole('button', { name: t.shopCard.next }).click();
      await page.getByText(t.shopCard.checksum).waitFor();
    },
  },
  {
    id: 'shop-card-remove',
    path: '/shop-card',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t }) => {
      await shopCard(page, SHOT_CARD);
      await page.getByRole('button', { name: t.shopCard.remove, exact: true }).click();
      await page.getByRole('alertdialog').waitFor();
    },
  },
  {
    // the audit keeps the card masked and reads it «было → стало»: one card replaced by another
    // just before, whatever earlier runs left in the shared shot database
    id: 'audit-shop-card',
    path: '/audit?action=shop_card.changed',
    as: 'owner',
    act: async ({ page }) => {
      await shopCard(page, EARLIER_CARD);
      await shopCard(page, SHOT_CARD);
    },
  },
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
  // Excel import (ticket #26)
  { id: 'catalog-import', path: '/catalog/import', as: 'owner' },
  {
    id: 'catalog-import-errors',
    path: '/catalog/import',
    as: 'owner',
    act: async ({ page, t }) => {
      const file = await exportWorkbook(page, (wb) => {
        const v = wb.getWorksheet('Объёмы')!;
        cell(v, 3, 'Цена, сум').value = 'дорого';
        cell(v, 4, 'В наличии, шт.').value = -2;
        cell(v, 5, 'Объём, мл').value = 20;
        const f = wb.getWorksheet('Ароматы')!;
        cell(f, 6, 'Верхние ноты').value = 'бергамот, ноты которой нет в справочнике';
        cell(f, 7, 'Хит').value = 'возможно';
      });
      await page.getByTestId('excel-file').setInputFiles(file);
      await page.getByTestId('excel-report').waitFor();
      await page.getByText(t.catalog.excel.errorsHint).waitFor();
    },
  },
  {
    id: 'catalog-import-warnings',
    path: '/catalog/import',
    as: 'owner',
    act: async ({ page }) => {
      // Reserves come from orders; stub 25 held on the first listed volume of the dry run's
      // answer, so the on hand the file sets shows the warning an open order would give it.
      await page.route('**/api/admin/catalog/import/dry-run', async (route) => {
        const response = await route.fetch();
        const report = (await response.json()) as {
          stock: { reserved: number; newOnHand: number; available: number; negative: boolean }[];
          warnings: unknown[];
          warningTotal: number;
        };
        const s = report.stock[0];
        if (s) {
          Object.assign(s, { reserved: 25, available: s.newOnHand - 25, negative: true });
          report.warnings.push({ sheet: 'volumes', row: 2, column: null, code: 'below_reserve' });
          report.warningTotal += 1;
        }
        await route.fulfill({ response, json: report });
      });
      const file = await exportWorkbook(page, (wb) => {
        const v = wb.getWorksheet('Объёмы')!;
        cell(v, 2, 'В наличии, шт.').value = 18;
        cell(v, 3, 'Цена, сум').value = 155_000;
        cell(v, 4, 'Цена, сум').value = 160_000;
      });
      await page.getByTestId('excel-file').setInputFiles(file);
      await page.getByTestId('excel-apply').waitFor();
    },
  },
  {
    id: 'catalog-import-applied',
    path: '/catalog/import',
    as: 'owner',
    ...importRestore,
    act: async ({ page, t }) => {
      const file = await exportWorkbook(page, (wb) => {
        const v = wb.getWorksheet('Объёмы')!;
        cell(v, 3, 'Цена, сум').value = 155_000;
        cell(v, 4, 'Цена, сум').value = 160_000;
      });
      await page.getByTestId('excel-file').setInputFiles(file);
      await page.getByTestId('excel-apply').click();
      await page.getByRole('button', { name: t.catalog.excel.applyConfirm }).click();
      await page.getByTestId('excel-applied').waitFor();
    },
  },
  {
    id: 'catalog-import-applied-warning',
    path: '/catalog/import',
    as: 'owner',
    ...importRestore,
    act: async ({ page, t }) => {
      // The reserve grew between the check and the write: the apply answer carries the warning
      // (the shot data has no orders, so the answer is patched).
      await page.route('**/api/admin/catalog/import/apply**', async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as { warnings: unknown[] };
        body.warnings = [
          {
            sheet: 'volumes',
            row: 2,
            column: null,
            code: 'below_reserve',
            params: { name: 'Guidance', ml: 10, onHand: 18, reserved: 25 },
          },
        ];
        await route.fulfill({ response, json: body });
      });
      const file = await exportWorkbook(page, (wb) => {
        const v = wb.getWorksheet('Объёмы')!;
        cell(v, 3, 'Цена, сум').value = 155_000;
        cell(v, 4, 'Цена, сум').value = 160_000;
      });
      await page.getByTestId('excel-file').setInputFiles(file);
      await page.getByTestId('excel-apply').click();
      await page.getByRole('button', { name: t.catalog.excel.applyConfirm }).click();
      await page.getByTestId('excel-applied').waitFor();
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
    // The owner set the set's Uzum link (#54).
    id: 'sets-uzum',
    path: '/sets',
    as: 'owner',
    setup: async ({ db }) => {
      await db.query(
        "update discovery_set set uzum_url = 'https://uzum.uz/ru/product/lummi-discovery-set'",
      );
    },
    teardown: async ({ db }) => {
      await db.query('update discovery_set set uzum_url = null');
    },
  },
  {
    // The same fragrance picked twice: the second field says so and «Сохранить» stays off.
    id: 'sets-duplicate',
    path: '/sets',
    as: 'owner',
    act: async ({ page, t }) => {
      const first = page.locator('#set-pick-0');
      const value = await nativeSelect(first).inputValue();
      await choose(page.locator('#set-pick-1'), value);
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
  // ---- Reviews panel (#41): the list, its filters, an empty result
  { id: 'reviews', path: '/reviews', as: 'manager', act: imagesLoaded },
  {
    id: 'reviews-filtered',
    path: '/reviews?rating=2&state=hidden',
    as: 'manager',
    act: imagesLoaded,
  },
  { id: 'reviews-published', path: '/reviews?state=published', as: 'manager' },
  // the order page shows its review (rating, comment, photos, state) and a link to «Отзывы»
  { id: 'order-with-review', path: '/orders/9005', as: 'manager', act: imagesLoaded },
  { id: 'order-with-review-published', path: '/orders/9004', as: 'manager' },
  { id: 'reviews-order', path: '/reviews?order=9005', as: 'manager', act: imagesLoaded },
  { id: 'reviews-empty', path: '/reviews?rating=5&from=2026-01-01&to=2026-01-02', as: 'manager' },
  // ---- «Не доставлено» (#55): the review requests of «Отзывы», the owner's birthday coupons
  { id: 'reviews-requests', path: '/reviews/requests', as: 'manager' },
  {
    id: 'reviews-requests-undelivered',
    path: '/reviews/requests?state=not_delivered',
    as: 'manager',
  },
  {
    id: 'reviews-requests-empty',
    path: '/reviews/requests?from=2026-01-01&to=2026-01-02',
    as: 'manager',
  },
  {
    id: 'reviews-requests-worst',
    path: '/reviews/requests',
    as: 'manager',
    setup: ({ db }) => seedWorstRequests(db),
    teardown: ({ db }) => forgetWorst(db),
  },
  { id: 'birthday-coupons-empty', path: '/birthday-coupons', as: 'owner' },
  {
    id: 'birthday-coupons',
    path: '/birthday-coupons',
    as: 'owner',
    setup: ({ db }) => seedShotCoupons(db),
    teardown: ({ db }) => forgetCoupons(db),
  },
  {
    id: 'birthday-coupons-undelivered',
    path: '/birthday-coupons?delivery=not_delivered',
    as: 'owner',
    setup: ({ db }) => seedShotCoupons(db),
    teardown: ({ db }) => forgetCoupons(db),
  },
  {
    id: 'birthday-coupons-worst',
    path: '/birthday-coupons',
    as: 'owner',
    setup: ({ db }) => seedWorstCoupons(db),
    teardown: ({ db }) => forgetCoupons(db),
  },
  // ---- Orders board (#52): the funnel over a normal day, carrying a card, the move menu, the
  // tracking dialog after a drop on «Передан в BTS», a closed column opened, empty, the worst case.
  // Viewport captures: the board fills the screen, and a full-page capture paints a board scrolled
  // sideways out of place
  {
    id: 'orders-board',
    path: '/orders',
    as: 'manager',
    ...boardOn,
    fullPage: false,
    act: boardLoaded,
  },
  {
    id: 'orders-board-drag',
    path: '/orders',
    as: 'manager',
    ...boardOn,
    fullPage: false,
    act: async ({ page }) => {
      await boardLoaded({ page } as ScreenContext);
      await carry(page, SHOT_ORDER.assembling, 'handed_to_bts');
    },
  },
  {
    id: 'orders-board-menu',
    path: '/orders',
    as: 'manager',
    ...boardOn,
    fullPage: false,
    act: async ({ page }) => {
      await boardLoaded({ page } as ScreenContext);
      await boardCard(page, SHOT_ORDER.checking);
      await page.locator(`[data-move-menu="${SHOT_ORDER.checking}"]`).click();
      await page.getByRole('menu').waitFor();
    },
  },
  {
    id: 'orders-board-hand',
    path: '/orders',
    as: 'manager',
    ...boardOn,
    fullPage: false,
    act: async ({ page }) => {
      await boardLoaded({ page } as ScreenContext);
      await carry(page, SHOT_ORDER.assembling, 'handed_to_bts');
      await page.mouse.up();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'orders-board-closed',
    path: '/orders',
    as: 'manager',
    ...boardOn,
    fullPage: false,
    act: async ({ page }) => {
      await boardLoaded({ page } as ScreenContext);
      await page.locator('[data-rail="cancelled"]').click();
      await page.locator('[data-column="cancelled"] [data-order]').first().waitFor();
      await page.waitForTimeout(200);
    },
  },
  { id: 'orders-board-empty', path: '/orders', as: 'manager', fullPage: false, act: emptyBoard },
  {
    id: 'orders-board-worst',
    path: '/orders',
    as: 'owner',
    setup: ({ db }) => boardCrowd(db),
    teardown: ({ db }) => boardCrowdBack(db),
    fullPage: false,
    act: async ({ page }) => {
      await boardLoaded({ page } as ScreenContext);
      await boardCard(page, 9301);
    },
  },
  {
    id: 'orders-board-search',
    path: '/orders?q=93+555',
    as: 'manager',
    ...boardOn,
    fullPage: false,
    act: boardLoaded,
  },
  // ---- Orders panel (#33): the list (behind «Список» since #52), every order state, the dialogs
  { id: 'orders-list', path: '/orders?view=list', as: 'manager' },
  { id: 'orders-filtered', path: '/orders?status=receipt_review', as: 'manager' },
  { id: 'orders-search', path: '/orders?view=list&q=93+555', as: 'manager' },
  { id: 'orders-empty', path: '/orders?view=list&q=7777777', as: 'manager' },
  // #56: «Скачать в Excel» is the owner's, in the header both views share
  { id: 'orders-export-list', path: '/orders?view=list&payment=paid', as: 'owner' },
  {
    id: 'orders-export-board',
    path: '/orders',
    as: 'owner',
    ...boardOn,
    fullPage: false,
    act: boardLoaded,
  },
  {
    id: 'order-awaiting',
    path: `/orders/${SHOT_ORDER.awaiting}`,
    as: 'manager',
    act: imagesLoaded,
  },
  {
    id: 'order-checking',
    path: `/orders/${SHOT_ORDER.checking}`,
    as: 'manager',
    act: imagesLoaded,
  },
  { id: 'order-review', path: `/orders/${SHOT_ORDER.review}`, as: 'manager', act: imagesLoaded },
  { id: 'order-paid', path: `/orders/${SHOT_ORDER.paid}`, as: 'manager', act: imagesLoaded },
  {
    id: 'order-assembling',
    path: `/orders/${SHOT_ORDER.assembling}`,
    as: 'manager',
    act: imagesLoaded,
  },
  { id: 'order-shipped', path: `/orders/${SHOT_ORDER.shipped}`, as: 'manager', act: imagesLoaded },
  {
    id: 'order-delivered',
    path: `/orders/${SHOT_ORDER.delivered}`,
    as: 'manager',
    act: imagesLoaded,
  },
  {
    id: 'order-cancelled',
    path: `/orders/${SHOT_ORDER.cancelled}`,
    as: 'owner',
    act: imagesLoaded,
  },
  { id: 'order-expired', path: `/orders/${SHOT_ORDER.expired}`, as: 'manager', act: imagesLoaded },
  { id: 'order-worst', path: `/orders/${SHOT_ORDER.worst}`, as: 'owner', act: imagesLoaded },
  {
    id: 'order-reject',
    path: `/orders/${SHOT_ORDER.review}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.detail.reject);
      await dialog.getByLabel(t.orders.rejectReasons.amount_mismatch, { exact: true }).check();
      await dialog
        .locator('textarea')
        .fill(
          'В чеке 144 000 сум, а к переводу 179 100 сум. Переведите разницу и пришлите оба чека.',
        );
    },
  },
  {
    // a shopper who reads Uzbek: the preview is in their language, whatever the manager's
    id: 'order-reject-uz-shopper',
    path: `/orders/${SHOT_ORDER.checking}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.detail.reject);
      await dialog.getByLabel(t.orders.rejectReasons.other, { exact: true }).check();
      await dialog.locator('textarea').fill('Chekda boshqa kunning sanasi koʻrsatilgan.');
    },
  },
  {
    id: 'order-reject-empty',
    path: `/orders/${SHOT_ORDER.review}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.detail.reject);
      await dialog.getByLabel(t.orders.rejectReasons.other, { exact: true }).check();
      await dialog.getByRole('button', { name: t.orders.detail.reject, exact: true }).click();
      await dialog.getByText(t.orders.rejectNoteRequired).waitFor();
    },
  },
  {
    id: 'order-cancel',
    path: `/orders/${SHOT_ORDER.paid}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.step.cancel);
      await dialog.getByLabel(t.orders.cancelReasons.out_of_stock, { exact: true }).check();
      await dialog.locator('textarea').fill('Флакон разбился при сборке');
    },
  },
  {
    id: 'order-hand',
    path: `/orders/${SHOT_ORDER.assembling}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.step.hand_to_bts);
      await dialog.getByLabel(t.orders.trackingLabel).fill('UZB 7704 1131 0058');
    },
  },
  {
    // the receipt in manual review: Candidate credits first
    id: 'order-confirm',
    path: `/orders/${SHOT_ORDER.review}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.detail.confirm);
      const first = dialog.locator('[data-credit-option] input').first();
      await first.waitFor();
      await first.check();
    },
  },
  {
    // «Показать другие», one of another amount picked: the reason it needs
    id: 'order-confirm-other',
    path: `/orders/${SHOT_ORDER.review}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.detail.confirm);
      await dialog.locator('[data-credit-option]').first().waitFor();
      await dialog.getByRole('button', { name: /\(\d+\)$/ }).click();
      // the transfer 40 000 short, the one the rejected receipt showed: the oldest of the others
      const short = dialog.locator('[data-credit-option]').last();
      await short.locator('input').check();
      await short.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await dialog.locator('textarea').fill('Перевела двумя частями, вторая придёт вечером');
    },
  },
  {
    // money that came with no receipt, from «Ожидает оплаты»
    id: 'order-confirm-no-receipt',
    path: `/orders/${SHOT_ORDER.awaiting}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.detail.confirm);
      await dialog.locator('[data-credit-option] input').first().check();
    },
  },
  {
    id: 'credits-link',
    path: '/credits?linked=unlinked',
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      await page.locator('[data-link-credit]:visible').first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(t.credits.orderNumber).fill(String(SHOT_ORDER.awaiting));
      await dialog.getByRole('button', { name: t.credits.find, exact: true }).click();
      await dialog.locator('[data-link-order]').waitFor();
    },
  },
  { id: 'credits', path: '/credits', as: 'manager' },
  { id: 'credits-unlinked', path: '/credits?linked=unlinked', as: 'manager' },
  // ---- «Не для заказа» (#49): an unlinked credit's actions, the mark dialog, the marked credits
  {
    id: 'credits-unlinked-menu',
    path: '/credits?linked=unlinked',
    as: 'manager',
    fullPage: false,
    act: async ({ page }) => {
      await page.locator('[data-mark-credit]:visible').first().hover();
    },
  },
  {
    id: 'credits-mark',
    path: '/credits?linked=unlinked',
    as: 'manager',
    fullPage: false,
    act: async ({ page }) => {
      await page.locator('[data-mark-credit]:visible').first().click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('textarea').fill('Мама перевела на продукты, к заказам не относится');
    },
  },
  { id: 'credits-not-for-order', path: '/credits?linked=not_for_order', as: 'manager' },
  {
    id: 'credits-unmark',
    path: '/credits?linked=not_for_order',
    as: 'manager',
    fullPage: false,
    act: async ({ page }) => {
      await page.locator('[data-unmark-credit]:visible').first().click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    // the AI confirmed the held receipt with a credit staff marked «Не для заказа» meanwhile
    id: 'order-credit-marked',
    path: `/orders/${SHOT_ORDER.review}`,
    as: 'manager',
    setup: ({ db }) => creditMarkedReceipt(db, true),
    teardown: ({ db }) => creditMarkedReceipt(db, false),
    act: imagesLoaded,
  },
  // ---- Refunds and returns (#40): a returned order with a refund, and the two dialogs
  {
    id: 'order-returned',
    path: `/orders/${SHOT_ORDER.returned}`,
    as: 'manager',
    act: imagesLoaded,
  },
  {
    // what is still owed after the partial refund comes in as the amount
    id: 'order-refund',
    path: `/orders/${SHOT_ORDER.returned}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.refund.action);
      await dialog
        .locator('textarea')
        .fill('Вернули остаток на карту покупателя: заказ вернулся целиком.');
    },
  },
  {
    // a delivered order before its return: two lines go back on hand, the third leaked
    id: 'order-return',
    path: `/orders/${SHOT_ORDER.deliveredMany}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.ret.action);
      const lines = dialog.locator('[data-return-line] input');
      await lines.nth(0).check();
      await lines.nth(1).check();
      await dialog.locator('textarea').fill('Покупательница вернула посылку: флакон 50 мл протёк.');
      // typing scrolled the form: show it from its title, the flags and the effects below
      await dialog.evaluate((el) => el.scrollTo(0, 0));
    },
  },
  {
    // the refund dialog on a delivered order with nothing owed: a refund is the manager's call
    id: 'order-refund-delivered',
    path: `/orders/${SHOT_ORDER.deliveredMany}`,
    as: 'manager',
    fullPage: false,
    act: async ({ page, t }) => {
      const dialog = await openOrderDialog(page, t.orders.refund.action);
      await dialog.getByLabel(t.orders.refund.amount).fill('25000');
      await dialog.locator('textarea').fill('Компенсация за задержку доставки');
    },
  },
  {
    // the return dialog at its worst: twelve lines, a 60-character name, five flagged, a reason of
    // the full 500 characters, seven-digit money; from the top (the flags)…
    id: 'order-return-worst',
    path: `/orders/${SHOT_ORDER.deliveredWorst}`,
    as: 'owner',
    fullPage: false,
    act: async (ctx) => {
      await worstReturnDialog(ctx);
    },
  },
  {
    // …and at its end (the reason, what will happen, the summary)
    id: 'order-return-worst-end',
    path: `/orders/${SHOT_ORDER.deliveredWorst}`,
    as: 'owner',
    fullPage: false,
    act: async (ctx) => {
      const dialog = await worstReturnDialog(ctx);
      await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    },
  },
  // Designed dropdown (ticket #47): the open list on a fine pointer; a phone shows the native
  // picker, so there the shot is the closed field. A disabled field is made by hand (no screen
  // has one): the attribute is all the styles read.
  {
    id: 'select-audit-open',
    path: '/audit',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t, width }) => {
      if (width < 640) await page.getByRole('button', { name: t.audit.filters.toggle }).click();
      const field = page.getByLabel(t.audit.filters.action);
      if (width >= 640) await openList(page, field);
      else await field.scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'select-orders-open',
    path: '/orders?view=list',
    as: 'manager',
    fullPage: false,
    act: async ({ page, t, width }) => {
      if (width < 640) await page.getByRole('button', { name: t.orders.filters.toggle }).click();
      const field = page.getByLabel(t.orders.filters.status);
      if (width >= 640) await openList(page, field);
      else await field.scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'select-long-open',
    path: '/bts-points',
    as: 'owner',
    fullPage: false,
    act: async ({ page, t, width }) => {
      if (width < 640) await page.getByRole('button', { name: t.btsPoints.filters }).click();
      const field = page.getByLabel(t.btsPoints.region);
      if (width >= 640) await openList(page, field);
      else await field.scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'select-disabled',
    path: '/orders?view=list',
    as: 'manager',
    fullPage: false,
    act: async ({ page, t, width }) => {
      if (width < 640) await page.getByRole('button', { name: t.orders.filters.toggle }).click();
      const field = page.getByLabel(t.orders.filters.payment);
      await nativeSelect(field).evaluate((el) => ((el as HTMLSelectElement).disabled = true));
      await field.evaluate((el) => {
        if (el instanceof HTMLButtonElement) el.disabled = true;
      });
    },
  },
  ...stockScreens,
  ...customerScreens,
  // ---- Reports (#42): the owner's sales report over the delivered shot orders (9006, 9012,
  // 9013; the returned 9011 drops out), with a partial refund of 9012 sent on 10 November
  {
    id: 'reports',
    path: '/reports',
    as: 'owner',
    setup: ({ db }) => shotRefund(db, 'add'),
    teardown: ({ db }) => shotRefund(db, 'remove'),
  },
  {
    id: 'reports-by-net',
    path: '/reports?from=2026-11-01&to=2026-11-14&top=net',
    as: 'owner',
    setup: ({ db }) => shotRefund(db, 'add'),
    teardown: ({ db }) => shotRefund(db, 'remove'),
  },
  { id: 'reports-invalid', path: '/reports?from=2026-11-14&to=2026-11-01', as: 'owner' },
  { id: 'reports-empty', path: '/reports?from=2026-01-01&to=2026-01-31', as: 'owner' },
  // ---- Marketing reports (#43): the same delivered shot orders by promo code (LUMMI10 on 9012
  // and 9013), by campaign link and first link, and the set discount (three rights 9006 opened,
  // one used by Ali's 9014); the openers of «Ссылки кампаний» count as opens and first links
  {
    id: 'reports-marketing',
    path: '/reports/marketing',
    as: 'owner',
    setup: ({ db }) => shotMarketing(db, 'add'),
    teardown: ({ db }) => shotMarketing(db, 'remove'),
  },
  {
    id: 'reports-marketing-range',
    path: '/reports/marketing?from=2026-11-01&to=2026-11-14',
    as: 'owner',
    setup: ({ db }) => shotMarketing(db, 'add'),
    teardown: ({ db }) => shotMarketing(db, 'remove'),
  },
  {
    id: 'reports-marketing-source',
    path: '/reports/marketing?source=store_qr',
    as: 'owner',
    setup: ({ db }) => shotMarketing(db, 'add'),
    teardown: ({ db }) => shotMarketing(db, 'remove'),
  },
  {
    id: 'reports-marketing-code',
    path: '/reports/marketing?code=LUMMI10',
    as: 'owner',
    setup: ({ db }) => shotMarketing(db, 'add'),
    teardown: ({ db }) => shotMarketing(db, 'remove'),
  },
  {
    id: 'reports-marketing-invalid',
    path: '/reports/marketing?from=2026-11-14&to=2026-11-01',
    as: 'owner',
    fullPage: false,
  },
  {
    id: 'reports-marketing-empty',
    path: '/reports/marketing?from=2026-01-01&to=2026-01-31',
    as: 'owner',
  },
  { id: 'not-found', path: '/no-such-page', as: 'owner' },
  { id: 'not-found-guest', path: '/no-such-page' },
];
