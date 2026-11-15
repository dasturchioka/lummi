import { homeDay, homeDayBack, shift } from './home-data';
import type { ShotSql } from './screens';

/*
 * The orders board's shot states (#52). The board reads «now» from the real clock, so «a normal
 * day» is the Home's (home-data.ts: the shot orders moved to today and the last two weeks), the
 * four shot orders the Home leaves where they were moved alike, and a dozen fresh orders by six
 * more customers, at minutes and hours from now, one or two in every column. `boardCrowd` adds
 * the worst case: 34 orders in «Собирается», long names, seven-digit totals, typed addresses.
 * Everything goes again in the teardown, so the next screen starts from the seed.
 */

/** Board shot orders take numbers from here: the orders panel's run 9001–9014. */
const DAY_FIRST = 9201;
const CROWD_FIRST = 9301;
const CROWD = 34;
/** Telegram ids no other shot takes. */
const CUSTOMERS = [
  { tg: 990000201, first: 'Sevara', last: 'Rahimova', phone: '+998901234501', lang: 'uz' },
  { tg: 990000202, first: 'Bekzod', last: 'Tursunov', phone: '+998901234502', lang: 'ru' },
  { tg: 990000203, first: 'Malika', last: 'Ergasheva', phone: '+998901234503', lang: 'uz' },
  { tg: 990000204, first: 'Otabek', last: 'Nazarov', phone: '+998901234504', lang: 'ru' },
  { tg: 990000205, first: 'Nilufar', last: 'Saidova', phone: '+998901234505', lang: 'uz' },
  { tg: 990000206, first: 'Rustam', last: null, phone: '+998901234506', lang: 'ru' },
  // the worst case's long name
  {
    tg: 990000207,
    first: 'Gulnorakhon-Mukhlisakhon',
    last: 'Abdurakhmonova-Kholmatova',
    phone: '+998901234507',
    lang: 'uz',
  },
] as const;

/** The path from checkout to each status, as the history writes it (ADR 0011). */
const PATH: [action: string, from: string, to: string, actor: 'customer' | 'ai' | 'staff'][] = [
  ['submit_receipt', 'awaiting_payment', 'receipt_review', 'customer'],
  ['confirm_payment', 'receipt_review', 'payment_confirmed', 'ai'],
  ['accept', 'payment_confirmed', 'accepted', 'staff'],
  ['start_assembly', 'accepted', 'assembling', 'staff'],
  ['hand_to_bts', 'assembling', 'handed_to_bts', 'staff'],
  ['deliver', 'handed_to_bts', 'delivered', 'staff'],
];

type Spec = {
  number: number;
  customer: number;
  status: string;
  /** How long ago it entered its status (a Postgres interval). */
  ago: string;
  lines: { pick: number; ml: number; qty: number }[];
  gift?: boolean;
  typed?: boolean;
};

const DAY: Spec[] = [
  {
    number: 9201,
    customer: 0,
    status: 'awaiting_payment',
    ago: '14 minutes',
    lines: [{ pick: 4, ml: 50, qty: 1 }],
  },
  {
    number: 9202,
    customer: 1,
    status: 'awaiting_payment',
    ago: '47 minutes',
    lines: [{ pick: 9, ml: 10, qty: 2 }],
  },
  {
    number: 9203,
    customer: 2,
    status: 'receipt_review',
    ago: '3 minutes',
    lines: [{ pick: 13, ml: 30, qty: 1 }],
  },
  {
    number: 9204,
    customer: 3,
    status: 'payment_confirmed',
    ago: '18 minutes',
    lines: [
      { pick: 21, ml: 30, qty: 1 },
      { pick: 22, ml: 10, qty: 1 },
    ],
  },
  {
    number: 9205,
    customer: 4,
    status: 'accepted',
    ago: '1 hour 5 minutes',
    lines: [{ pick: 30, ml: 50, qty: 1 }],
  },
  {
    number: 9206,
    customer: 5,
    status: 'accepted',
    ago: '25 minutes',
    lines: [{ pick: 31, ml: 30, qty: 1 }],
    gift: true,
  },
  {
    number: 9207,
    customer: 0,
    status: 'assembling',
    ago: '52 minutes',
    lines: [
      { pick: 35, ml: 10, qty: 1 },
      { pick: 36, ml: 10, qty: 1 },
      { pick: 37, ml: 30, qty: 1 },
    ],
  },
  {
    number: 9208,
    customer: 1,
    status: 'assembling',
    ago: '3 hours 40 minutes',
    lines: [{ pick: 40, ml: 50, qty: 1 }],
  },
  {
    number: 9209,
    customer: 2,
    status: 'handed_to_bts',
    ago: '1 day 3 hours',
    lines: [{ pick: 44, ml: 30, qty: 2 }],
  },
  {
    number: 9210,
    customer: 3,
    status: 'handed_to_bts',
    ago: '5 hours 12 minutes',
    lines: [{ pick: 48, ml: 10, qty: 1 }],
    typed: true,
  },
  {
    number: 9211,
    customer: 4,
    status: 'delivered',
    ago: '2 days 1 hour',
    lines: [{ pick: 52, ml: 50, qty: 1 }],
  },
  {
    number: 9212,
    customer: 5,
    status: 'cancelled',
    ago: '3 hours',
    lines: [{ pick: 56, ml: 30, qty: 1 }],
  },
];

/** The four shot orders the Home leaves in place, moved like the rest: [number, action, to]. */
const ALSO_MOVED: [number: number, anchor: string | null, target: string][] = [
  [9001, null, `now() - interval '1 hour 52 minutes'`],
  [9002, 'submit_receipt', `now() - interval '6 minutes'`],
  [9009, 'cancel', `now() - interval '1 day 2 hours'`],
  [9011, 'return', `now() - interval '2 days 5 hours'`],
];
let alsoMoved: { number: number; seconds: number }[] = [];

async function addCustomers(db: ShotSql) {
  for (const c of CUSTOMERS)
    await db.query(
      `insert into customers (telegram_id, first_name, last_name, language, phone, phone_verified_at, data_consent_at)
       values ($1, $2, $3, $4, $5, now(), now())
       on conflict (telegram_id) do update set first_name = excluded.first_name, last_name = excluded.last_name`,
      [c.tg, c.first, c.last, c.lang, c.phone],
    );
}

/** Inserts the specs' orders with their lines and history, each entering its status `ago`. */
async function insertOrders(db: ShotSql, specs: Spec[]) {
  const volumes = (
    await db.query(
      `select f.id as fragrance_id, f.slug, f.name, f.original_brand, v.id as volume_id, v.ml, v.price, v.photo_hash
       from fragrances f join volumes v on v.fragrance_id = f.id where not f.hidden order by f.slug, v.ml`,
    )
  ).rows;
  const points = (
    await db.query(
      `select p.*, r.name_ru, r.name_uz, r.delivery_tariff from bts_points p join regions r on r.id = p.region_id
       where p.active order by r.position, p.code`,
    )
  ).rows;
  const regions = (await db.query(`select * from regions order by position desc`)).rows;
  const customers = new Map(
    (
      await db.query(
        `select id, telegram_id from customers where telegram_id = any($1::bigint[])`,
        [CUSTOMERS.map((c) => c.tg)],
      )
    ).rows.map((r) => [Number(r.telegram_id), Number(r.id)]),
  );
  const staffId = Number(
    (await db.query(`select id from staff where telegram_id = 990000002`)).rows[0]?.id ?? 0,
  );
  for (const [index, s] of specs.entries()) {
    const customer = CUSTOMERS[s.customer]!;
    // a spread of cities: every 37th active point
    const point = s.typed ? null : points[(index * 37 + s.number) % points.length]!;
    const region = point ?? regions[index % regions.length]!;
    const lines = s.lines.map((l, position) => {
      const all = volumes.filter((v) => Number(v.ml) === l.ml);
      const v = all[l.pick % all.length]!;
      return { ...l, v, position, price: Number(v.price), total: Number(v.price) * l.qty };
    });
    const items = lines.reduce((n, l) => n + l.total, 0);
    const fee = items >= 250_000 ? 0 : Number(region.delivery_tariff ?? 25_000);
    const steps = PATH.slice(0, Math.max(0, PATH.findIndex((p) => p[2] === s.status) + 1));
    const cancelled = s.status === 'cancelled';
    // checkout a little before the first step; each step 25 minutes after the last
    const created = `now() - interval '${s.ago}' - interval '${(steps.length + (cancelled ? 1 : 0)) * 25 + 10} minutes'`;
    const { rows } = await db.query(
      `insert into orders (number, customer_id, status, reserve_until, recipient_name, recipient_phone, region_id,
         region_name_ru, region_name_uz, bts_point_id, point_code, point_name, point_city, point_address,
         typed_address, is_gift, items_subtotal, discount_amount, delivery_fee, threshold_base,
         threshold_base_amount, total, amount_due, idempotency_key, tracking_number, created_at, updated_at)
       overriding system value
       values ($1, $2, $3, ${created} + interval '12 hours', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16::int, 0, $17::int, 'after', $16::int, $16::int + $17::int, $16::int + $17::int, gen_random_uuid(), $18, ${created}, now())
       returning id`,
      [
        s.number,
        customers.get(customer.tg),
        s.status,
        `${customer.first}${customer.last ? ` ${customer.last}` : ''}`,
        customer.phone,
        point ? point.region_id : region.id,
        region.name_ru,
        region.name_uz,
        point?.id ?? null,
        point?.code ?? null,
        point?.name ?? null,
        point?.city ?? null,
        point?.address ?? null,
        s.typed
          ? 'Mahalla «Bogʻishamol», Navoiy koʻchasi 14, 3-uy, 27-xonadon, moʻljal: maktab'
          : null,
        s.gift ?? false,
        items,
        fee,
        ['handed_to_bts', 'delivered'].includes(s.status) ? `BTS ${s.number}0 4471` : null,
      ],
    );
    const orderId = Number(rows[0]!.id);
    for (const l of lines)
      await db.query(
        `insert into order_lines (order_id, position, kind, volume_id, fragrance_id, slug, name_ru, name_uz, brand, ml,
           photo, unit_price, regular_unit_price, marked_down, qty, line_total)
         values ($1, $2, 'volume', $3, $4, $5, $6, $6, $7, $8, $9, $10, $10, false, $11, $12)`,
        [
          orderId,
          l.position,
          l.v.volume_id,
          l.v.fragrance_id,
          l.v.slug,
          l.v.name,
          l.v.original_brand,
          l.ml,
          l.v.photo_hash,
          l.price,
          l.qty,
          l.total,
        ],
      );
    const history = cancelled
      ? [['cancel', 'awaiting_payment', 'cancelled', 'staff'] as const]
      : steps;
    for (const [i, [action, from, to, actor]] of history.entries()) {
      const before = (history.length - 1 - i) * 25;
      await db.query(
        `insert into order_events (order_id, from_status, to_status, action, actor_type, actor_id, reason, payload, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now() - interval '${s.ago}' - make_interval(mins => $9))`,
        [
          orderId,
          from,
          to,
          action,
          actor,
          actor === 'staff' ? staffId : actor === 'customer' ? customers.get(customer.tg) : null,
          action === 'cancel' ? 'out_of_stock' : null,
          JSON.stringify(
            action === 'hand_to_bts' ? { trackingNumber: `BTS ${s.number}0 4471` } : {},
          ),
          before,
        ],
      );
    }
  }
}

async function forget(db: ShotSql, first: number, count: number) {
  await db.query(`delete from orders where number >= $1 and number < $1 + $2`, [first, count]);
}

/** A normal day on the board (see above). */
export async function boardDay(db: ShotSql) {
  if (alsoMoved.length) return;
  await homeDay(db);
  for (const [number, anchor, target] of ALSO_MOVED) {
    const at = anchor
      ? `(select max(e.created_at) from order_events e join orders o on o.id = e.order_id
          where o.number = $1 and e.action = '${anchor}')`
      : `(select created_at from orders where number = $1)`;
    const { rows } = await db.query(`select extract(epoch from (${target} - ${at}))::float8 as s`, [
      number,
    ]);
    const seconds = Math.round(Number(rows[0]?.s));
    if (!Number.isFinite(seconds)) throw new Error(`shot order ${number} has no ${anchor}`);
    await shift(db, number, seconds);
    alsoMoved.push({ number, seconds });
  }
  // a move stamps updated_at with its event's time (the board's history filter reads it first);
  // the shot orders were written without moves, so stamp them as a move would have
  await db.query(
    `update orders o set updated_at = greatest(o.created_at,
       (select max(e.created_at) from order_events e where e.order_id = o.id))
     where o.number between 9001 and 9013`,
  );
  await forget(db, DAY_FIRST, DAY.length);
  await addCustomers(db);
  await insertOrders(db, DAY);
}

export async function boardDayBack(db: ShotSql) {
  await forget(db, DAY_FIRST, DAY.length);
  await forget(db, CROWD_FIRST, CROWD);
  await db.query(`delete from customers where telegram_id = any($1::bigint[])`, [
    CUSTOMERS.map((c) => c.tg),
  ]);
  for (const m of alsoMoved.reverse()) await shift(db, m.number, -m.seconds);
  alsoMoved = [];
  await homeDayBack(db);
}

/**
 * The worst case: 34 orders in «Собирается» (over the column's view), most by the longest name,
 * six 50 ml bottles of three fragrances (seven-digit totals), typed addresses and gifts.
 */
export async function boardCrowd(db: ShotSql) {
  await boardDay(db);
  const specs: Spec[] = Array.from({ length: CROWD }, (_, i) => ({
    number: CROWD_FIRST + i,
    customer: i % 3 === 2 ? i % 6 : 6,
    status: 'assembling',
    ago: `${2 + i * 97} minutes`,
    lines:
      i % 4 === 0
        ? [{ pick: i, ml: 10, qty: 1 }]
        : [
            { pick: i, ml: 50, qty: 2 },
            { pick: i + 1, ml: 50, qty: 2 },
            { pick: i + 2, ml: 50, qty: 2 },
          ],
    gift: i % 5 === 1,
    typed: i % 3 === 0,
  }));
  await insertOrders(db, specs);
}

export const boardCrowdBack = boardDayBack;
