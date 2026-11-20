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

let savedStock: unknown[] | undefined;
/** Concentrate (ADR 0043) low on a few fragrances and gone on others, the sets' boxes out, flacons short. */
async function lowStock(db: ShotSql) {
  savedStock ??= (await db.query('select id, concentrate_ul from fragrances order by id')).rows.map(
    (r) => [r.id, r.concentrate_ul],
  );
  // a few low (150 ml, under the 300 ml threshold), a few gone (less than a 10 ml fill)
  await db.query(
    `update fragrances set concentrate_ul = 150000 where id in (select id from fragrances order by id limit 4 offset 1)`,
  );
  await db.query(
    `update fragrances set concentrate_ul = 5000 where id in (select id from fragrances order by id limit 3 offset 7)`,
  );
  await db.query(`update discovery_set set on_hand = 0`);
  await db.query(
    `update consumables set on_hand = 0, needs_recount = true where use = 'flacon' and ml = 10`,
  );
  await db.query(`update consumables set on_hand = 8 where use = 'box' and ml = 10`);
}
async function restoreStock(db: ShotSql) {
  if (!savedStock) return;
  for (const [id, ul] of savedStock as [unknown, unknown][]) {
    await db.query('update fragrances set concentrate_ul = $2 where id = $1', [id, ul]);
  }
  await db.query('update discovery_set set on_hand = 20');
  await db.query(`update consumables set on_hand = 0, needs_recount = false`);
  savedStock = undefined;
}

/** The first fragrance row's «Пересчитать», on whichever layout the viewport shows. */
const editFirst = async (page: Page) => {
  await page
    .locator(
      '[data-testid^="stock-card-f"] button:visible, tr[data-testid^="stock-row-f"] button:visible',
    )
    .first()
    .click();
  await page.locator(COUNT_INPUT).waitFor();
};
const COUNT_INPUT = 'input[id^="count-block-"]:visible, input[id^="count-table-"]:visible';
/** The state screens are viewport shots of the open row: the full stock table is many rows tall. */
const showEditor = (page: Page) =>
  page
    .locator(`${COUNT_INPUT}, [role=alert]:visible`)
    .first()
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));

/** Oil for the first fragrance (#76): one made-up oil receipt of 250 g and its stock move. */
async function someOil(db: ShotSql) {
  await db.query('update fragrances set oil_mg = 250000 where id = 1');
  await db.query(
    `insert into oil_receipts (fragrance_id, supplier, invoice, received_on, oil_mg, price_per_gram,
       discount_percent, import_percent)
     values (1, 'Test Oils', 'INV-0001', '2026-11-17', 250000, 4000, 9, 3)`,
  );
  await db.query(
    `insert into stock_moves (fragrance_id, kind, oil_mg, oil_receipt_id, details, actor_type)
     select 1, 'oil_receipt', 250000, max(id), '{"invoice":"INV-0001","supplier":"Test Oils"}', 'system'
     from oil_receipts`,
  );
}
async function noOil(db: ShotSql) {
  await db.query('delete from stock_moves');
  await db.query('delete from bottlings');
  await db.query('delete from oil_receipts');
  await db.query('update fragrances set oil_mg = 0');
  await db.query(`update consumables set on_hand = 0 where use = 'ethanol'`);
}

export const stockScreens: Screen[] = [
  // the warehouse (#76, #82): a fragrance's concentrate, oil, mixing, receipts and history
  {
    id: 'warehouse',
    path: '/stock/1',
    as: 'owner',
    setup: ({ db }) => someOil(db),
    teardown: ({ db }) => noOil(db),
  },
  {
    id: 'warehouse-manager',
    path: '/stock/1',
    as: 'manager',
    setup: ({ db }) => someOil(db),
    teardown: ({ db }) => noOil(db),
  },
  {
    // mixing 100 ml with 40 ml of spirit on hand: the preview, then the refusal
    id: 'warehouse-mixing-short',
    path: '/stock/1',
    as: 'manager',
    fullPage: false,
    setup: async ({ db }) => {
      await someOil(db);
      await db.query(`update consumables set on_hand = 40 where use = 'ethanol'`);
    },
    teardown: ({ db }) => noOil(db),
    act: async ({ page }) => {
      await page.locator('#mix-ml').fill('100');
      await page.locator('#mix-ml').press('Enter');
      await page.locator('[role=alert]:visible').first().waitFor();
      await page.locator('#mix-ml').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
  },
  {
    // consumables (ADR 0043): a flacon short after a handover («Пересчитайте»), a box running low
    id: 'stock-consumables',
    path: '/stock',
    as: 'manager',
    fullPage: false,
    setup: ({ db }) => lowStock(db),
    teardown: ({ db }) => restoreStock(db),
    act: async ({ page }) => {
      await page.locator('[data-testid="consumables"]').evaluate((el) => el.scrollIntoView());
    },
  },
  {
    id: 'stock-oil-low',
    path: '/stock?filter=oilLow',
    as: 'owner',
    setup: ({ db }) => someOil(db),
    teardown: ({ db }) => noOil(db),
  },
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
      await page.locator(COUNT_INPUT).fill('1');
      await page.locator('input[id^="count-reason-"]:visible').fill('Пересчёт');
      await page.keyboard.press('Enter');
      await page.locator('[role=alert]:visible').first().waitFor();
      await showEditor(page);
    },
  },
  {
    id: 'stock-conflict',
    fullPage: false,
    teardown: async ({ db }) => {
      await db.query('update fragrances set concentrate_ul = 1000000 where concentrate_ul = 19000');
    },
    path: '/stock',
    as: 'manager',
    act: async ({ page }) => {
      await editFirst(page);
      const input = page.locator(COUNT_INPUT);
      await input.fill('15');
      // somebody else saves 19 ml meanwhile (a real write), so the editor's save gets a real 409
      const fragranceId = (await input.getAttribute('id'))!.split('-f').pop()!;
      const origin = new URL(page.url()).origin;
      const other = await page.request.put(
        `${origin}/api/admin/warehouse/fragrances/${fragranceId}/concentrate`,
        { data: { ml: 19, reason: 'Пересчёт' } },
      );
      if (!other.ok()) throw new Error(`the other editor's save failed: ${other.status()}`);
      await page.locator('input[id^="count-reason-"]:visible').fill('Пересчёт');
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
      await page.locator('#set-on-hand-reason').fill('Пересчёт');
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
      await page.locator('main a[href^="/customers/"]:visible').first().click();
      await page.locator('[data-testid^="order-row-"]').first().waitFor();
    },
  },
  ...(['owner', 'manager'] as const).map((as): Screen => ({
    // #30: the date of birth on the page; only the owner corrects it (dialog open), a manager
    // sees the date alone
    id: `customer-birth-date-${as}`,
    path: '/customers?q=ali_valiyev',
    as,
    setup: async ({ db }) => {
      await seedCustomers(db);
      await db.query(
        `update customers set birth_date = '1996-03-14', birth_date_set_at = now() where telegram_id = $1`,
        [FIRST],
      );
    },
    teardown: ({ db }) => clearCustomers(db),
    act: async ({ page }) => {
      await page.locator('main a[href^="/customers/"]:visible').first().click();
      await page.locator('[data-testid="birth-date"]').waitFor();
      if (as === 'owner') {
        await page.locator('[data-testid="birth-date-edit"]').click();
        await page.getByRole('dialog').waitFor();
      }
    },
    fullPage: false,
  })),
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
      await page.locator('main a[href^="/customers/"]:visible').first().click();
      await page.locator('[data-testid^="order-row-"]').first().waitFor();
    },
  },
];
