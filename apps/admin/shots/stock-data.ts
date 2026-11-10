import type { Page } from '@playwright/test';
import type { Screen, ShotSql } from './screens';

/**
 * Stock and customers shot data (#27), written straight to the shot database and removed again
 * after each screen: customers under reserved Telegram ids 97000NNNN, their orders tagged with the
 * recipient name `shot27`, and (for the stock screens) a reserve on one 10 ml volume.
 */
const FIRST = 970000000;
const TAG = 'shot27';

type Person = {
  name: string;
  last?: string;
  username?: string;
  phone?: string;
  lang?: string;
  blocked?: boolean;
};
const PEOPLE: Person[] = [
  { name: 'Ali', last: 'Valiyev', username: 'ali_valiyev', phone: '+998901234567', lang: 'ru' },
  { name: 'Dilnoza', last: 'Karimova', phone: '+998935550101', lang: 'uz' },
  {
    name: 'Jasur',
    last: 'Toshmatov',
    username: 'jasur_t',
    phone: '+998977770202',
    lang: 'uz',
    blocked: true,
  },
  {
    name: 'Abdurahmonov Muhammadjon Saidakbar oʻgʻli',
    last: 'Hamidullaxodjayev',
    username: 'muhammadjon_saidakbar_ogli_official',
    phone: '+998881112233',
    lang: 'uz',
  },
  { name: 'Sora', lang: 'ru' },
];

async function addOrder(
  db: ShotSql,
  telegramId: number,
  status: string,
  items: number,
  createdAt: string,
) {
  await db.query(
    `insert into orders (customer_id, status, reserve_until, recipient_name, recipient_phone, region_id,
       region_name_ru, region_name_uz, typed_address, items_subtotal, delivery_fee, threshold_base,
       threshold_base_amount, total, amount_due, idempotency_key, created_at)
     select c.id, $2::order_status, $4::timestamptz, $5, '+998901234567', r.id, r.name_ru, r.name_uz, 'adres',
       $3, 25000, 'before', $3, $3 + 25000, $3 + 25000, gen_random_uuid(), $4::timestamptz
     from customers c cross join (select * from regions order by id limit 1) r where c.telegram_id = $1`,
    [telegramId, status, items, createdAt, TAG],
  );
}

export async function seedCustomers(db: ShotSql, extra = 0, hugeTotals = false) {
  for (const [i, p] of PEOPLE.entries()) {
    await db.query(
      `insert into customers (telegram_id, first_name, last_name, username, phone, language, bot_blocked)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
      [
        FIRST + i,
        p.name,
        p.last ?? null,
        p.username ?? null,
        p.phone ?? null,
        p.lang ?? 'ru',
        p.blocked ?? false,
      ],
    );
  }
  if (extra > 0) {
    await db.query(
      `insert into customers (telegram_id, first_name, last_name, language, created_at)
       select $1 + 100 + g, 'Клиент', 'N' || g, (case when g % 3 = 0 then 'uz' else 'ru' end)::language,
         now() - (g || ' minutes')::interval
       from generate_series(1, $2::int) g on conflict do nothing`,
      [FIRST, extra],
    );
  }
  await addOrder(db, FIRST, 'delivered', hugeTotals ? 4_820_000 : 620_000, '2026-11-02T08:00:00Z');
  await addOrder(db, FIRST, 'delivered', hugeTotals ? 3_950_000 : 330_000, '2026-11-05T08:00:00Z');
  await addOrder(db, FIRST, 'cancelled', 150_000, '2026-11-08T08:00:00Z');
  await addOrder(db, FIRST, 'awaiting_payment', 99_000, '2026-11-10T08:00:00Z');
  await addOrder(db, FIRST + 1, 'handed_to_bts', 210_000, '2026-11-09T08:00:00Z');
  await addOrder(db, FIRST + 2, 'delivered', 99_000, '2026-11-06T08:00:00Z');
  await addOrder(db, FIRST + 3, 'delivered', 450_000, '2026-11-07T08:00:00Z');
}

export async function clearCustomers(db: ShotSql) {
  await db.query(`delete from orders where recipient_name = $1`, [TAG]);
  await db.query(`delete from customers where telegram_id >= $1 and telegram_id < $2`, [
    FIRST,
    FIRST + 100_000,
  ]);
}

/** Holds `qty` of the first fragrance's 10 ml by an open order, so reserve and available are not trivial. */
async function reserveTen(db: ShotSql, qty: number) {
  await seedCustomers(db);
  await addOrder(db, FIRST + 4, 'accepted', 99_000 * qty, '2026-11-10T09:00:00Z');
  await db.query(
    `insert into order_lines (order_id, position, kind, volume_id, name_ru, name_uz, ml, unit_price,
       regular_unit_price, qty, line_total)
     select o.id, 0, 'volume', v.id, f.name, f.name, 10, 99000, 99000, $1, 99000 * $1
     from orders o, (select v.* from volumes v join fragrances f on f.id = v.fragrance_id
       where v.ml = 10 order by lower(f.name) limit 1) v
       join fragrances f on f.id = v.fragrance_id
     where o.recipient_name = $2 and o.status = 'accepted' limit 1`,
    [qty, TAG],
  );
}

let saved: { id: unknown; name: unknown; hidden: unknown } | undefined;
async function longName(db: ShotSql) {
  const [f] = (
    await db.query(
      `select f.id, f.name, f.hidden from fragrances f join volumes v on v.fragrance_id = f.id and v.ml = 10
       order by lower(f.name) limit 1`,
    )
  ).rows;
  saved ??= { id: f!.id, name: f!.name, hidden: f!.hidden };
  await db.query(`update fragrances set name = $2 where id = $1`, [
    f!.id,
    'Ambre Nuit Extraordinaire Privée Édition Limitée Noire',
  ]);
}
async function restoreName(db: ShotSql) {
  if (!saved) return;
  await db.query(`update fragrances set name = $2 where id = $1`, [saved.id, saved.name]);
  saved = undefined;
}

let savedOnHand: unknown[] | undefined;
async function lowStock(db: ShotSql) {
  savedOnHand ??= (await db.query('select id, on_hand from volumes order by id')).rows.map((r) => [
    r.id,
    r.on_hand,
  ]);
  // a few low, a few zero, among the rest at their seed count
  await db.query(
    `update volumes set on_hand = 2 where id in (select id from volumes order by id limit 4 offset 1)`,
  );
  await db.query(
    `update volumes set on_hand = 0 where id in (select id from volumes order by id limit 3 offset 7)`,
  );
  await db.query(`update discovery_set set on_hand = 0`);
}
async function restoreStock(db: ShotSql) {
  if (!savedOnHand) return;
  for (const [id, onHand] of savedOnHand as [unknown, unknown][]) {
    await db.query('update volumes set on_hand = $2 where id = $1', [id, onHand]);
  }
  await db.query('update discovery_set set on_hand = 20');
  savedOnHand = undefined;
}

const editFirst = async (page: Page) => {
  await page
    .locator(
      '[data-testid^="stock-block-v"] button:visible, tr[data-testid^="stock-row-v"] button:visible',
    )
    .first()
    .click();
  await page.locator('input[id^="on-hand-"]:visible').waitFor();
};
/** The state screens are viewport shots of the open row: the full stock table is hundreds of rows tall. */
const showEditor = (page: Page) =>
  page
    .locator('input[id^="on-hand-"]:visible, [role=alert]:visible')
    .first()
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));

export const stockScreens: Screen[] = [
  {
    id: 'stock',
    path: '/stock',
    as: 'manager',
    setup: ({ db }) => lowStock(db),
    teardown: ({ db }) => restoreStock(db),
  },
  {
    id: 'stock-low',
    path: '/stock?filter=low',
    as: 'owner',
    setup: ({ db }) => lowStock(db),
    teardown: ({ db }) => restoreStock(db),
  },
  {
    id: 'stock-zero',
    path: '/stock?filter=zero',
    as: 'owner',
    setup: ({ db }) => lowStock(db),
    teardown: ({ db }) => restoreStock(db),
  },
  { id: 'stock-hidden', path: '/stock?visibility=hidden', as: 'owner' },
  { id: 'stock-search', path: '/stock?q=aven', as: 'owner' },
  {
    id: 'stock-editing',
    fullPage: false,
    path: '/stock',
    as: 'manager',
    act: async ({ page }) => {
      await editFirst(page);
      await showEditor(page);
    },
  },
  {
    id: 'stock-below-reserve',
    fullPage: false,
    path: '/stock',
    as: 'manager',
    setup: ({ db }) => reserveTen(db, 3),
    teardown: ({ db }) => clearCustomers(db),
    act: async ({ page }) => {
      await editFirst(page);
      await page.locator('input[id^="on-hand-"]:visible').fill('1');
      await page.keyboard.press('Enter');
      await page.locator('[role=alert]:visible').first().waitFor();
      await showEditor(page);
    },
  },
  {
    id: 'stock-conflict',
    fullPage: false,
    teardown: async ({ db }) => {
      await db.query('update volumes set on_hand = 20 where on_hand = 19');
    },
    path: '/stock',
    as: 'manager',
    act: async ({ page }) => {
      await editFirst(page);
      const input = page.locator('input[id^="on-hand-"]:visible');
      await input.fill('15');
      // somebody else saves 19 meanwhile (a real write), so the editor's save gets a real 409
      const volumeId = (await input.getAttribute('id'))!.split('-v').pop()!;
      const origin = new URL(page.url()).origin;
      const other = await page.request.patch(`${origin}/api/admin/volumes/${volumeId}/on-hand`, {
        data: { onHand: 19 },
      });
      if (!other.ok()) throw new Error(`the other editor's save failed: ${other.status()}`);
      await page.keyboard.press('Enter');
      await page.locator('[role=alert]:visible').first().waitFor();
      await showEditor(page);
    },
  },
  {
    id: 'sets-on-hand-conflict',
    path: '/sets',
    as: 'manager',
    fullPage: false,
    act: async ({ page }) => {
      const input = page.locator('#set-on-hand');
      await input.fill('7');
      // somebody saved another count while this page was open
      await page.route('**/api/admin/sets/discovery/on-hand', (route) =>
        route.fulfill({ status: 409, json: { code: 'on_hand_changed', current: 12 } }),
      );
      await page.keyboard.press('Enter');
      await page.locator('[role=alert]:visible').first().waitFor();
      await page.locator('#set-on-hand').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  {
    id: 'w-stock-long-name',
    fullPage: false,
    path: '/stock',
    as: 'owner',
    setup: ({ db }) => longName(db),
    teardown: ({ db }) => restoreName(db),
  },
];

export const customerScreens: Screen[] = [
  {
    id: 'customers',
    path: '/customers',
    as: 'manager',
    setup: ({ db }) => seedCustomers(db),
    teardown: ({ db }) => clearCustomers(db),
  },
  {
    id: 'customers-search',
    path: '/customers?q=ali',
    as: 'owner',
    setup: ({ db }) => seedCustomers(db),
    teardown: ({ db }) => clearCustomers(db),
  },
  {
    id: 'customers-phone',
    path: '/customers?q=%2B998%2093&sort=spent',
    as: 'owner',
    setup: ({ db }) => seedCustomers(db),
    teardown: ({ db }) => clearCustomers(db),
  },
  { id: 'customers-empty', path: '/customers?q=zzzz', as: 'owner' },
  {
    id: 'customer-page',
    path: '/customers?q=ali_valiyev',
    as: 'manager',
    setup: ({ db }) => seedCustomers(db),
    teardown: ({ db }) => clearCustomers(db),
    act: async ({ page }) => {
      await page.locator('main a[href^="/customers/"]').first().click();
      await page.locator('[data-testid^="order-row-"]').first().waitFor();
    },
  },
  {
    id: 'w-customers-500',
    path: '/customers?sort=spent&page=3',
    as: 'owner',
    setup: ({ db }) => seedCustomers(db, 500, true),
    teardown: ({ db }) => clearCustomers(db),
  },
  {
    id: 'w-customers-7-digits',
    path: '/customers?sort=spent',
    as: 'owner',
    setup: ({ db }) => seedCustomers(db, 0, true),
    teardown: ({ db }) => clearCustomers(db),
  },
  {
    id: 'w-customer-long-name',
    path: '/customers?q=Abdurahmonov',
    as: 'owner',
    setup: ({ db }) => seedCustomers(db, 0, true),
    teardown: ({ db }) => clearCustomers(db),
    act: async ({ page }) => {
      await page.locator('main a[href^="/customers/"]').first().click();
      await page.locator('[data-testid^="order-row-"]').first().waitFor();
    },
  },
];
