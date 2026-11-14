import { randomUUID } from 'node:crypto';
import { SHOT_QR_CODE } from './campaign-data';
import { SHOT_ORDER } from './orders-data';

type Sql = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** The marketing shot's own order: Ali's second, with an upgrade right from his 9006. */
const SHOT_RIGHT_ORDER = SHOT_ORDER.usedRight;
const SHOT_CUSTOMERS = { ali: 990000101, dil: 990000102 };
/** The openers `seedShotOpens` writes (Клиент 1–3), with the first link each is given. */
const OPENERS: [telegramId: number, link: string][] = [
  [981000001, SHOT_QR_CODE],
  [981000002, 'insta-nov'],
  [981000003, 'insta-nov'],
];

/** Tashkent wall clock on 2026-11-<day> as an ISO instant. */
const at = (day: number, hh: number, mm: number) =>
  new Date(Date.UTC(2026, 10, day, hh - 5, mm)).toISOString();

/**
 * The marketing report's shot data (#43) over the delivered shot orders (9006, 9012, 9013): LUMMI10
 * held by 9012 and 9013, as their snapshots say; 9006 through `insta-nov` and 9012 through the
 * store QR that prefills LUMMI10; the customers' first links; three rights 9006 opened (as a set
 * would), one used by Ali's order 9014 through the channel link. `remove` undoes all of it, so the
 * other screens keep their data. Idempotent.
 */
export async function shotMarketing(db: Sql, what: 'add' | 'remove') {
  const orderId = async (number: number) =>
    Number((await db.query(`select id from orders where number = $1`, [number])).rows[0]!.id);
  const customerId = async (tg: number) =>
    Number((await db.query(`select id from customers where telegram_id = $1`, [tg])).rows[0]!.id);
  const linkId = async (code: string) =>
    Number((await db.query(`select id from campaign_links where code = $1`, [code])).rows[0]!.id);

  const delivered = await orderId(SHOT_ORDER.delivered);
  const many = await orderId(SHOT_ORDER.deliveredMany);
  const worst = await orderId(SHOT_ORDER.deliveredWorst);
  const ali = await customerId(SHOT_CUSTOMERS.ali);
  const dil = await customerId(SHOT_CUSTOMERS.dil);
  const openers = await Promise.all(OPENERS.map(([tg]) => customerId(tg)));

  // ---- remove (and start clean)
  await db.query(
    `delete from upgrade_rights where source_order_id = $1
       or used_by_order_id in (select id from orders where number = $2)`,
    [delivered, SHOT_RIGHT_ORDER],
  );
  await db.query(`delete from orders where number = $1`, [SHOT_RIGHT_ORDER]);
  await db.query(`delete from promo_code_uses where order_id = any($1)`, [[many, worst]]);
  await db.query(`update orders set campaign_link_id = null where id = any($1)`, [
    [delivered, many],
  ]);
  await db.query(`update customers set acquisition_link_id = null where id = any($1)`, [
    [ali, dil, ...openers],
  ]);
  await db.query(`delete from campaign_opens where customer_id = any($1)`, [[ali, dil]]);
  if (what === 'remove') return;

  // ---- add
  const insta = await linkId('insta-nov');
  const stand = await linkId(SHOT_QR_CODE);
  const channel = await linkId('channel-sets');
  const open = (customer: number, link: number, when: string) =>
    db.query(`insert into campaign_opens (link_id, customer_id, opened_at) values ($1, $2, $3)`, [
      link,
      customer,
      when,
    ]);
  await open(ali, insta, at(5, 10, 0));
  await open(dil, stand, at(7, 14, 0));
  await open(ali, channel, at(12, 10, 0));
  await db.query(`update customers set acquisition_link_id = $2 where id = $1`, [ali, insta]);
  await db.query(`update customers set acquisition_link_id = $2 where id = $1`, [dil, stand]);
  for (const [i, [, code]] of OPENERS.entries())
    await db.query(`update customers set acquisition_link_id = $2 where id = $1`, [
      openers[i],
      await linkId(code),
    ]);
  await db.query(`update orders set campaign_link_id = $2 where id = $1`, [delivered, insta]);
  await db.query(`update orders set campaign_link_id = $2 where id = $1`, [many, stand]);
  await db.query(
    `insert into promo_code_uses (promo_code_id, order_id, customer_id)
     select (select id from promo_codes where code = 'LUMMI10'), o.id, o.customer_id
     from orders o where o.id = any($1)`,
    [[many, worst]],
  );

  // three rights 9006 opened on its delivery day, covering its fragrance
  const line = (
    await db.query(
      `select l.fragrance_id, l.name_ru, l.brand, l.volume_id, l.slug, l.name_uz, l.ml, l.photo,
         l.unit_price, l.qty, l.line_total,
         (select min(created_at) from order_events e where e.order_id = l.order_id and e.to_status = 'delivered') as opened
       from order_lines l where l.order_id = $1 order by l.position limit 1`,
      [delivered],
    )
  ).rows[0]!;
  const covers = JSON.stringify([
    { fragranceId: Number(line.fragrance_id), name: line.name_ru, brand: line.brand },
  ]);
  const opened = (line.opened as Date).toISOString();
  for (const unit of [0, 1, 2])
    await db.query(
      `insert into upgrade_rights (customer_id, source, source_order_id, source_position, source_unit,
         fragrances, percent, opened_at, expires_at)
       values ($1, 'set', $2, 0, $3, $4, 20, $5, $5::timestamptz + interval '30 days')`,
      [ali, delivered, unit, covers, opened],
    );

  // Ali's 9014: the same bottle twice, one of them 20 % off with his first right, delivered 13 Nov
  const unitPrice = Number(line.unit_price);
  const items = unitPrice * 2;
  const discount = Math.round((unitPrice * 20) / 100);
  const right = Number(
    (
      await db.query(
        `select id from upgrade_rights where source_order_id = $1 and source_unit = 0`,
        [delivered],
      )
    ).rows[0]!.id,
  );
  const { rows } = await db.query(
    `insert into orders (number, customer_id, status, reserve_until, recipient_name, recipient_phone,
       region_id, region_name_ru, region_name_uz, typed_address, items_subtotal, discount,
       discount_amount, delivery_fee, threshold_base, threshold_base_amount, total, amount_due,
       idempotency_key, campaign_link_id, created_at, updated_at)
     overriding system value
     select $1::int, $2::bigint, 'delivered', $3::timestamptz + interval '12 hours', 'Ali',
       '+998901112233', r.id, r.name_ru, r.name_uz, 'Samarqand, Registon koʻchasi 1', $4::int,
       $5::jsonb, $6::int, 0, 'before', $4::int, $4::int - $6::int, $4::int - $6::int, $7::uuid,
       $8::bigint, $3::timestamptz, $3::timestamptz
     from (select * from regions order by position limit 1) r
     returning id`,
    [
      SHOT_RIGHT_ORDER,
      ali,
      at(12, 11, 0),
      items,
      JSON.stringify({
        type: 'upgrade_right',
        id: right,
        source: 'set',
        percent: 20,
        amount: discount,
        lineKey: '0',
      }),
      discount,
      randomUUID(),
      channel,
    ],
  );
  const order = Number(rows[0]!.id);
  await db.query(
    `insert into order_lines (order_id, position, kind, volume_id, fragrance_id, slug, name_ru, name_uz,
       brand, ml, photo, unit_price, regular_unit_price, marked_down, qty, line_total)
     values ($1, 0, 'volume', $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, false, 2, $11)`,
    [
      order,
      line.volume_id,
      line.fragrance_id,
      line.slug,
      line.name_ru,
      line.name_uz,
      line.brand,
      line.ml,
      line.photo,
      unitPrice,
      items,
    ],
  );
  await db.query(
    `insert into order_events (order_id, from_status, to_status, action, actor_type, actor_id, created_at)
     values ($1, 'handed_to_bts', 'delivered', 'deliver', 'staff', (select min(id) from staff), $2)`,
    [order, at(13, 15, 0)],
  );
  await db.query(`update upgrade_rights set used_by_order_id = $2 where id = $1`, [right, order]);
}
