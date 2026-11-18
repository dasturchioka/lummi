import type { PromoCodeInput } from '@lummi/contracts';

type Call = (path: string, method: string, body?: unknown) => Promise<Response>;

const base: PromoCodeInput = {
  code: '',
  kind: 'percent',
  percent: null,
  amount: null,
  maxDiscount: null,
  gift: null,
  expiresOn: null,
  minOrderTotal: null,
  totalLimit: null,
  perCustomerLimit: null,
  newCustomersOnly: false,
  appliesToMarkedDown: false,
  active: true,
};

/** The longest code the pattern allows (32), with every condition set: the list's worst row. */
export const WORST_PROMO = 'BLOGER_MALIKA_NOVOGODNIY_2026_UZ';

/** A seven-digit fixed code with every condition, its last day long past (break-ui). */
export const WORST_FIXED_PROMO = 'SENTYABR_CHEGIRMASI_1250000_SOM';

/**
 * Shot data for «Промокоды» (#29): a working code with every condition, a plain one, a fixed
 * amount, one past its last day and one switched off, written through the owner's endpoints
 * (idempotent: a code that exists is left as it is). Uses need orders, so every count is 0.
 */
export async function seedShotPromo(call: Call) {
  const list = (await (await call('/admin/promo-codes', 'GET')).json()) as { code: string }[];
  const have = new Set(list.map((p) => p.code));
  const codes: Partial<PromoCodeInput>[] = [
    { code: 'VESNA', percent: 20, active: false },
    { code: 'OSEN15', percent: 15, expiresOn: '2026-10-31', totalLimit: 200 },
    { code: 'MINUS50', kind: 'fixed', amount: 50_000, minOrderTotal: 250_000, totalLimit: 100 },
    { code: 'LUMMI10', percent: 10 },
    {
      code: WORST_PROMO,
      percent: 15,
      maxDiscount: 1_500_000,
      expiresOn: '2026-12-31',
      minOrderTotal: 1_250_000,
      totalLimit: 1_000_000,
      perCustomerLimit: 1,
      newCustomersOnly: true,
      appliesToMarkedDown: true,
    },
    {
      code: WORST_FIXED_PROMO,
      kind: 'fixed',
      amount: 1_250_000,
      expiresOn: '2026-09-30',
      minOrderTotal: 2_500_000,
      totalLimit: 1_000_000,
      perCustomerLimit: 99,
      newCustomersOnly: true,
    },
  ];
  for (const c of codes) {
    if (have.has(c.code as string)) continue;
    const res = await call('/admin/promo-codes', 'POST', { ...base, ...c });
    if (res.status !== 201) throw new Error(`promo ${c.code}: ${res.status}`);
  }
}

type Sql = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

/** The customer whose orders hold the shot uses; a Telegram id no other shot takes. */
const USES_CUSTOMER = 990000097;

/**
 * `n` orders of one shot customer, each holding a use of `code` (as `createOrder` writes them),
 * so the editor shows a used code: the count, the note in place of «Удалить».
 */
export async function holdUses(db: Sql, code: string, n: number) {
  await db.query(
    `insert into customers (telegram_id, first_name, language) values ($1, 'Shot', 'ru')
     on conflict (telegram_id) do nothing`,
    [USES_CUSTOMER],
  );
  await db.query(
    `with o as (
       insert into orders (customer_id, reserve_until, recipient_name, recipient_phone, region_id,
         region_name_ru, region_name_uz, typed_address, items_subtotal, discount_amount,
         delivery_fee, threshold_base, threshold_base_amount, total, amount_due, idempotency_key)
       select c.id, now() + interval '12 hours', 'Shot', '+998901234567', r.id, r.name_ru,
         r.name_uz, 'Shot', 298000, 50000, 0, 'after', 248000, 248000, 248000, gen_random_uuid()
       from customers c, (select * from regions order by position limit 1) r,
         generate_series(1, $2::int)
       where c.telegram_id = $1
       returning id, customer_id
     )
     insert into promo_code_uses (promo_code_id, order_id, customer_id)
     select (select id from promo_codes where code = $3), o.id, o.customer_id from o`,
    [USES_CUSTOMER, n, code],
  );
}

/** What `addPromoStats` changed, for `removePromoStats` to put back. */
let before: {
  createdAt: unknown[][];
  order: { id: unknown; items: unknown; total: unknown; due: unknown } | null;
  uses: unknown[][];
  usedIds: unknown[];
} | null = null;

const STATS_ORDERS = [9006, 9012, 9013];

/**
 * What the list shows per code (#65): the delivered shot orders 9012 and 9013 held by LUMMI10, and
 * 9006 held by the worst code with a nine-digit sale (987 654 321 so'm). Codes are made "now" and
 * the shot orders are dated early November, so the codes' creation day moves back to 1 Nov while
 * it runs. `removePromoStats` puts back exactly what this changed.
 */
export async function addPromoStats(db: Sql) {
  const SALE = 987_654_321;
  const ids = (
    await db.query(
      `select id, number, items_subtotal, total, amount_due from orders where number = any($1)`,
      [STATS_ORDERS],
    )
  ).rows;
  const id = (n: number) => ids.find((r) => Number(r.number) === n)!.id;
  const worst = ids.find((r) => Number(r.number) === 9006)!;
  const orderIds = [id(9006), id(9012), id(9013)];
  before = {
    createdAt: (await db.query(`select id, created_at from promo_codes`)).rows.map((r) => [
      r.id,
      r.created_at,
    ]),
    order: { id: worst.id, items: worst.items_subtotal, total: worst.total, due: worst.amount_due },
    uses: (
      await db.query(
        `select promo_code_id, order_id, customer_id, voided_at from promo_code_uses where order_id = any($1)`,
        [orderIds],
      )
    ).rows.map((r) => [r.promo_code_id, r.order_id, r.customer_id, r.voided_at]),
    usedIds: orderIds,
  };
  await db.query(`delete from promo_code_uses where order_id = any($1)`, [orderIds]);
  await db.query(`update promo_codes set created_at = '2026-11-01T00:00:00Z'`);
  await db.query(
    `update orders set items_subtotal = $2, total = $2 + delivery_fee - discount_amount,
       amount_due = $2 + delivery_fee - discount_amount where id = $1`,
    [id(9006), SALE],
  );
  for (const [orders, code] of [
    [[id(9012), id(9013)], 'LUMMI10'],
    [[id(9006)], WORST_PROMO],
  ] as const)
    await db.query(
      `insert into promo_code_uses (promo_code_id, order_id, customer_id)
       select (select id from promo_codes where code = $2), o.id, o.customer_id
       from orders o where o.id = any($1)`,
      [orders, code],
    );
}

/** Puts back the creation days, the order's figures and the uses `addPromoStats` took. */
export async function removePromoStats(db: Sql) {
  if (!before) return;
  const b = before;
  before = null;
  await db.query(`delete from promo_code_uses where order_id = any($1)`, [b.usedIds]);
  for (const [pid, at] of b.createdAt)
    await db.query(`update promo_codes set created_at = $2 where id = $1`, [pid, at]);
  if (b.order)
    await db.query(
      `update orders set items_subtotal = $2, total = $3, amount_due = $4 where id = $1`,
      [b.order.id, b.order.items, b.order.total, b.order.due],
    );
  for (const [pid, oid, cid, voided] of b.uses)
    await db.query(
      `insert into promo_code_uses (promo_code_id, order_id, customer_id, voided_at) values ($1, $2, $3, $4)`,
      [pid, oid, cid, voided],
    );
}

/** Drops the shot customer's orders, and with them their uses. */
export async function forgetUses(db: Sql) {
  await db.query(
    `delete from orders where customer_id = (select id from customers where telegram_id = $1)`,
    [USES_CUSTOMER],
  );
}

/** Fifty-four more codes (sixty in all), for the list's worst case: every state, long codes,
 * seven-digit amounts and limits. Removed again by `forgetPromoList`. */
export async function seedPromoList(db: Sql) {
  const stems = [
    'BLOGER_DILNOZA',
    'TOSHKENT_KUZ',
    'INSTAGRAM_STORIES_NOYABR',
    'UZUM_MARKET_QAYTA',
    'YANGI_YIL',
    'BAHOR',
    'NAVRUZ_BAYRAMI_SOVGASI',
    'TELEGRAM_KANAL',
  ];
  const rows = Array.from({ length: 54 }, (_, i) => {
    const code = `${stems[i % stems.length]}_${String(i + 1).padStart(2, '0')}`.slice(0, 32);
    const fixed = i % 3 === 0;
    return [
      `WC_${code}`.slice(0, 32),
      fixed ? 'fixed' : 'percent',
      fixed ? null : [5, 10, 15, 20, 25, 100][i % 6],
      fixed ? [25_000, 50_000, 1_250_000][(i / 3) % 3] : null,
      !fixed && i % 4 === 1 ? 1_500_000 : null,
      // past days read «Истёк», later ones carry their last day
      i % 5 === 0 ? '2026-09-30' : i % 5 === 2 ? '2027-12-31' : null,
      i % 4 === 2 ? 1_250_000 : null,
      i % 6 === 3 ? 1_000_000 : i % 6 === 4 ? 100 : null,
      i % 7 === 1 ? 1 : null,
      i % 8 === 5,
      i % 9 === 4,
      i % 7 !== 6,
    ];
  });
  for (const r of rows)
    await db.query(
      `insert into promo_codes (code, kind, percent, amount, max_discount, expires_at,
         min_order_total, total_limit, per_customer_limit, new_customers_only,
         applies_to_marked_down, active)
       values ($1, $2, $3, $4, $5,
         case when $6::date is null then null else ($6::date + time '23:59:59') at time zone 'Asia/Tashkent' end,
         $7, $8, $9, $10, $11, $12)
       on conflict (code) do nothing`,
      r,
    );
}

export async function forgetPromoList(db: Sql) {
  await db.query(`delete from promo_codes where code like 'WC\\_%'`);
}
