import type { ShotSql } from './screens';

/*
 * The admin Home's shot states (#48), over the orders panel's shot orders (orders-data.ts). The
 * Home reads «now» from the real clock, so a «normal day» moves whole shot orders in time (their
 * history, receipts and paying credit together, so each stays consistent): two receipts held for
 * a person minutes ago, payments confirmed today and a week ago, deliveries spread over the last
 * two weeks for the bars. Teardown moves every one back by the same interval.
 */

/** How each shot order is moved: the event (or the held receipt) that lands at `target`. */
const DAY: {
  number: number;
  anchor: 'held_receipt' | 'confirm_payment' | 'deliver';
  target: string;
}[] = [
  // receipts held for a person: 9003 the oldest, 12 minutes; the worst case 5 minutes
  { number: 9003, anchor: 'held_receipt', target: `now() - interval '12 minutes'` },
  { number: 9008, anchor: 'held_receipt', target: `now() - interval '5 minutes'` },
  // paid today: 9004 waits to be accepted (41 min), 9010 is assembling, 9005 left for BTS
  { number: 9004, anchor: 'confirm_payment', target: `now() - interval '41 minutes'` },
  { number: 9010, anchor: 'confirm_payment', target: `now() - interval '2 hours 10 minutes'` },
  { number: 9005, anchor: 'confirm_payment', target: `now() - interval '4 hours 30 minutes'` },
  // paid on this weekday a week ago, earlier in the day; 9006 then delivered within the week
  { number: 9006, anchor: 'confirm_payment', target: `now() - interval '7 days 1 hour'` },
  { number: 9007, anchor: 'confirm_payment', target: `now() - interval '7 days 3 hours'` },
  // delivered nine days ago (the 7 days before) and today (today's bar in Sage)
  { number: 9012, anchor: 'deliver', target: `now() - interval '9 days'` },
  { number: 9013, anchor: 'deliver', target: `now() - interval '3 hours'` },
];

let moved: { number: number; seconds: number }[] = [];
/** The system line before the day: the userbot's heartbeat and the last backup, if any. */
let system: { beat: unknown; backup: unknown } | undefined;

/** A reserved Humo message id (the orders shots take 990001 on): 9003's own credit. */
const CANDIDATE_MESSAGE = 990_900;

/** Moves a whole shot order in time: the order, its history, receipts and paying credit (the board shots too). */
export async function shift(db: ShotSql, number: number, seconds: number) {
  const params = [number, seconds];
  const by = `make_interval(secs => $2)`;
  const order = `(select id from orders where number = $1)`;
  await db.query(
    `update orders set created_at = created_at + ${by}, reserve_until = reserve_until + ${by} where number = $1`,
    params,
  );
  await db.query(
    `update order_events set created_at = created_at + ${by} where order_id = ${order}`,
    params,
  );
  await db.query(
    `update receipts set created_at = created_at + ${by} where order_id = ${order}`,
    params,
  );
  await db.query(
    `update credits set occurred_at = occurred_at + ${by}
     where id = (select credit_id from orders where number = $1)`,
    params,
  );
}

/** A normal day on the Home: the shot orders moved to today, a week ago and the last two weeks. */
export async function homeDay(db: ShotSql) {
  if (moved.length) return;
  // a healthy system line: the userbot seen 27 s ago, last night's backup at 03:00 Tashkent
  const [beatRow] = (await db.query(`select seen_at from userbot_heartbeat`)).rows;
  const [backupRow] = (await db.query(`select last_success_at from backup_status`)).rows;
  system = { beat: beatRow?.seen_at ?? null, backup: backupRow?.last_success_at ?? null };
  await db.query(
    `insert into userbot_heartbeat (id, seen_at) values (true, now() - interval '27 seconds')
     on conflict (id) do update set seen_at = excluded.seen_at`,
  );
  await db.query(
    `insert into backup_status (id, last_success_at)
     values (true, (date_trunc('day', now() at time zone 'Asia/Tashkent') + interval '3 hours') at time zone 'Asia/Tashkent')
     on conflict (id) do update set last_success_at = excluded.last_success_at`,
  );
  for (const m of DAY) {
    const anchor =
      m.anchor === 'held_receipt'
        ? `(select min(r.created_at) from receipts r join orders o on o.id = r.order_id
            where o.number = $1 and r.verdict = 'manual_review')`
        : `(select min(e.created_at) from order_events e join orders o on o.id = e.order_id
            where o.number = $1 and e.action = '${m.anchor}')`;
    const { rows } = await db.query(
      `select extract(epoch from (${m.target} - ${anchor}))::float8 as s`,
      [m.number],
    );
    const seconds = Math.round(Number(rows[0]?.s));
    if (!Number.isFinite(seconds)) throw new Error(`shot order ${m.number} has no ${m.anchor}`);
    await shift(db, m.number, seconds);
    moved.push({ number: m.number, seconds });
  }
  // 9003's money came 2 minutes before its receipt: the Now block names it beside the receipt
  await db.query(
    `insert into humo_messages (message_id, text, received_at) values ($1, 'shot: home', now() - interval '14 minutes')`,
    [CANDIDATE_MESSAGE],
  );
  await db.query(
    `insert into credits (humo_message_id, amount_tiyin, occurred_at, card_last4, card_mask, counterparty, event_handled_at)
     select $1, o.amount_due * 100, date_trunc('minute', now() - interval '14 minutes'), right(sc.number, 4),
       'HUMOCARD *' || right(sc.number, 4), 'CLICK P2P HUMO2UZCAR', now()
     from orders o cross join shop_card sc where o.number = 9003`,
    [CANDIDATE_MESSAGE],
  );
}

export async function homeDayBack(db: ShotSql) {
  await db.query(`delete from credits where humo_message_id = $1`, [CANDIDATE_MESSAGE]);
  await db.query(`delete from humo_messages where message_id = $1`, [CANDIDATE_MESSAGE]);
  for (const m of moved.reverse()) await shift(db, m.number, -m.seconds);
  moved = [];
  if (!system) return;
  if (system.beat === null) await db.query(`delete from userbot_heartbeat`);
  else await db.query(`update userbot_heartbeat set seen_at = $1`, [system.beat]);
  if (system.backup === null) await db.query(`delete from backup_status`);
  else await db.query(`update backup_status set last_success_at = $1`, [system.backup]);
  system = undefined;
}

let beat: { saved: boolean; at: unknown } = { saved: false, at: null };

/** The userbot fell silent 34 minutes ago and the payment pause opened then (#36). */
export async function humoSilent(db: ShotSql) {
  const { rows } = await db.query(`select seen_at from userbot_heartbeat`);
  beat = { saved: true, at: rows[0]?.seen_at ?? null };
  await db.query(
    `insert into userbot_heartbeat (id, seen_at) values (true, now() - interval '34 minutes')
     on conflict (id) do update set seen_at = excluded.seen_at`,
  );
  await db.query(
    `insert into payment_pauses (cause, started_at) values ('heartbeat', now() - interval '34 minutes')`,
  );
}

export async function humoBack(db: ShotSql) {
  await db.query(`delete from payment_pauses where ended_at is null`);
  if (!beat.saved) return;
  if (beat.at === null) await db.query(`delete from userbot_heartbeat`);
  else await db.query(`update userbot_heartbeat set seen_at = $1`, [beat.at]);
  beat = { saved: false, at: null };
}

let card: Record<string, unknown> | undefined;

/** No shop card: checkout is closed (#28). */
export async function noCard(db: ShotSql) {
  const { rows } = await db.query(`select number, holder, updated_at from shop_card`);
  card ??= rows[0];
  await db.query(`delete from shop_card`);
}

export async function cardBack(db: ShotSql) {
  if (!card) return;
  await db.query(
    `insert into shop_card (id, number, holder, updated_at) values (true, $1, $2, $3)
     on conflict (id) do nothing`,
    [card.number, card.holder, card.updated_at],
  );
  card = undefined;
}
