type Sql = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

/**
 * Shot data for the «не доставлено» views (#55). The review requests sit on the shot orders for
 * good (`seedShotRequests`: the answered ones are the reviews' orders 9004-9009, 9012 was never
 * delivered to the bot, 9013 awaits an answer). The birthday coupons and the worst-case rows come
 * and go with their screens (`setup` / `teardown`), so no other screen sees them.
 */

export async function seedShotRequests(db: Sql) {
  await db.query(
    `update orders set review_request = null, review_requested_at = null
     where number between 9001 and 9014`,
  );
  // asked a day after delivery; 9009's review is still being written, it counts as answered
  await db.query(
    `update orders set review_request = 'sent',
       review_requested_at = now() - ((9010 - number) * 8 || ' hours')::interval
     where number between 9004 and 9009`,
  );
  await db.query(
    `update orders set review_request = 'not_delivered', review_requested_at = now() - interval '3 hours'
     where number = 9012`,
  );
  await db.query(
    `update orders set review_request = 'sent', review_requested_at = now() - interval '5 hours'
     where number = 9013`,
  );
}

/** First shot telegram id of the worst-case customers (the shot orders' own are 990000101-104). */
const WORST_TG = 990000201;
/** The shop's longest plausible names, a one-letter one and one with emoji. */
const WORST_NAMES: [string, string | null][] = [
  ['Абдурахмонбобоев-Мирзаахмедов', 'Шарофиддинходжаевич'],
  ['Я', null],
  ['Муҳаммадризо', 'Ўғли'],
  ['Anvar 🌿', 'Karimov'],
  ['Nodirabegim', 'Abdurahmonova-Qodirova'],
  ['Ли', null],
];

async function worstCustomers(db: Sql, count: number) {
  for (let i = 0; i < count; i++) {
    const [first, last] = WORST_NAMES[i % WORST_NAMES.length]!;
    await db.query(
      `insert into customers (telegram_id, first_name, last_name, language, phone)
       values ($1, $2, $3, $4, $5) on conflict (telegram_id) do nothing`,
      [WORST_TG + i, first, last, i % 2 ? 'uz' : 'ru', `+99890${String(7000000 + i)}`],
    );
  }
}

/** 30 requests of three states over six customers with the worst names, on top of the seeded ones. */
export async function seedWorstRequests(db: Sql) {
  await forgetWorst(db);
  await worstCustomers(db, 6);
  await db.query(
    `insert into orders (customer_id, status, reserve_until, recipient_name, recipient_phone, region_id,
       region_name_ru, region_name_uz, typed_address, items_subtotal, delivery_fee, threshold_base, threshold_base_amount,
       total, amount_due, idempotency_key, review_request, review_requested_at, created_at, updated_at)
     select c.id, 'delivered', now(), 'shot worst', '+998900000000', o.region_id, o.region_name_ru,
       o.region_name_uz, 'shot', 100000, 0, 'after', 100000, 100000, 100000, gen_random_uuid(),
       (array['sent','not_delivered','sent'])[1 + n % 3],
       now() - (n * 7 || ' hours')::interval, now(), now()
     from generate_series(1, 30) n
     join customers c on c.telegram_id = ${WORST_TG} + (n % 6)
     cross join (select * from orders where number = 9012) o`,
  );
  // every third «sent» is answered
  await db.query(
    `insert into reviews (order_id, customer_id, rating, step)
     select id, customer_id, 1 + (id % 5), 'done' from orders
     where recipient_name = 'shot worst' and review_request = 'sent' and id % 2 = 0`,
  );
}

/** Six coupons of the shot customers: delivered and used, delivered and open, not delivered, expired. */
export async function seedShotCoupons(db: Sql) {
  await forgetCoupons(db);
  const rows: [number, number, string, number, number, number | null, string, string][] = [
    // customer tg, year, birthday, percent, max, used on order, issued, expires
    [
      990000101,
      2026,
      '2026-11-20',
      20,
      100_000,
      9006,
      '2026-11-10 05:00+00',
      '2026-11-24 19:00+00',
    ],
    [
      990000102,
      2026,
      '2026-11-28',
      20,
      100_000,
      null,
      '2026-11-13 05:00+00',
      '2026-12-02 19:00+00',
    ],
    [990000103, 2026, '2026-11-19', 15, 80_000, null, '2026-11-12 05:00+00', '2026-11-23 19:00+00'],
    [
      990000104,
      2026,
      '2026-11-17',
      20,
      100_000,
      null,
      '2026-11-10 05:00+00',
      '2026-11-21 19:00+00',
    ],
    [990000101, 2025, '2025-11-20', 10, 50_000, null, '2025-11-10 05:00+00', '2025-11-24 19:00+00'],
    [990000102, 2025, '2025-11-28', 10, 50_000, null, '2025-11-13 05:00+00', '2025-12-02 19:00+00'],
  ];
  for (const [tg, year, birthday, percent, max, orderNumber, issued, expires] of rows) {
    // not delivered: the bot-blocked customers (103 in 2026, 102 in 2025)
    const lost = (tg === 990000103 && year === 2026) || (tg === 990000102 && year === 2025);
    await db.query(
      `insert into birthday_coupons (customer_id, birthday_year, birthday, percent, max_amount, issued_at,
         expires_at, used_by_order_id, outbox_id)
       select c.id, $2, $3::date, $4, $5, $6::timestamptz, $7::timestamptz,
         (select id from orders where number = $8), $9
       from customers c where c.telegram_id = $1
       on conflict (customer_id, birthday_year) do nothing`,
      [tg, year, birthday, percent, max, issued, expires, orderNumber, lost ? null : 1],
    );
  }
}

/** 30 coupons over six customers with the worst names: two pages, every delivery and use state. */
export async function seedWorstCoupons(db: Sql) {
  await forgetWorst(db);
  await worstCustomers(db, 6);
  await db.query(
    `insert into birthday_coupons (customer_id, birthday_year, birthday, percent, max_amount, issued_at,
       expires_at, used_by_order_id, outbox_id)
     select c.id, 2000 + n, (2000 + n || '-11-20')::date, 20, 1000000 + n, now() - (n * 2 || ' days')::interval,
       now() + (20 - n || ' days')::interval, null, case when n % 3 = 0 then null else n end
     from generate_series(1, 30) n
     join customers c on c.telegram_id = ${WORST_TG} + (n % 6)`,
  );
}

export async function forgetCoupons(db: Sql) {
  await db.query(
    `delete from birthday_coupons where customer_id in (select id from customers where telegram_id between 990000101 and 990000104)`,
  );
  await forgetWorst(db);
}

export async function forgetWorst(db: Sql) {
  await db.query(
    `delete from reviews where order_id in (select id from orders where recipient_name = 'shot worst')`,
  );
  await db.query(`delete from orders where recipient_name = 'shot worst'`);
  await db.query(
    `delete from birthday_coupons where customer_id in (select id from customers where telegram_id >= ${WORST_TG} and telegram_id < ${WORST_TG + 100})`,
  );
  await db.query(
    `delete from customers where telegram_id >= ${WORST_TG} and telegram_id < ${WORST_TG + 100}`,
  );
}
