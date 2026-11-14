import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

type Sql = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

/** Shot orders take numbers from here up (the identity starts at 1001, far below). */
export const SHOT_ORDER = {
  awaiting: 9001,
  checking: 9002,
  review: 9003,
  paid: 9004,
  shipped: 9005,
  delivered: 9006,
  cancelled: 9007,
  worst: 9008,
  expired: 9009,
  assembling: 9010,
  returned: 9011,
  deliveredMany: 9012,
  deliveredWorst: 9013,
} as const;
const FIRST = 9001;
const LAST = 9013;
/** Shot Humo messages take reserved ids no other shot uses (the customers: 990000101-104). */
const HUMO_FIRST = 990001;

/** Exactly 60 characters: a snapshot keeps any name, so the worst line is written as bought. */
export const WORST_LINE_NAME = 'Ночной сад у тихого моря после летнего дождя под Самаркандом';

type Customer = {
  tg: number;
  first: string;
  last: string | null;
  username: string | null;
  phone: string;
  lang: 'ru' | 'uz';
};
const CUSTOMERS: Customer[] = [
  {
    tg: 990000101,
    first: 'Ali',
    last: 'Karimov',
    username: 'ali_karimov',
    phone: '+998901112233',
    lang: 'ru',
  },
  {
    tg: 990000102,
    first: 'Dilnoza',
    last: 'Yusupova',
    username: null,
    phone: '+998935556677',
    lang: 'uz',
  },
  {
    tg: 990000103,
    first: 'Aleksandra-Konstantina',
    last: 'Abdurakhmanova-Ivanovskaya',
    username: 'aleksandra_konstantina_abdurakhmanova',
    phone: '+998977654321',
    lang: 'ru',
  },
  { tg: 990000104, first: 'Jasur', last: null, username: null, phone: '+998712345678', lang: 'uz' },
];

type Actor = { type: 'customer' | 'staff' | 'ai' | 'system'; staff?: number };
type Step = {
  action: string;
  from: string;
  to: string;
  at: string;
  by: Actor;
  reason?: string;
  payload?: Record<string, unknown>;
};
type Check = {
  isReceipt: number;
  amountMatches: number;
  recipientMatches: number;
  choiceConfidence: number;
  confirmed: boolean;
  outcome: 'confirmed' | 'manual_review' | 'credit_taken' | 'stale';
  provider?: 'typesafe' | 'openai';
  reason?: string;
};
/** The AI's answer when it confirmed a receipt (ADR 0013 thresholds 0.8 / 0.6). */
const SURE: Check = {
  isReceipt: 0.99,
  amountMatches: 0.97,
  recipientMatches: 0.98,
  choiceConfidence: 0.74,
  confirmed: true,
  outcome: 'confirmed',
};
type ReceiptSpec = {
  at: string;
  verdict:
    | 'pending'
    | 'manual_review'
    | 'rejected'
    | 'ai_confirmed'
    | 'manager_confirmed'
    | 'payment_not_found';
  file: string;
  source: 'miniapp' | 'bot';
  pdf?: boolean;
  amount: number;
  reviewReason?: 'duplicate' | 'not_confirmed' | 'judge_failed';
  check?: Check;
};
/** An unlinked credit some minutes after the order: its amount differs by `deltaTiyin`. */
type Spare = { afterMin: number; deltaTiyin?: number; card?: string; from?: string };
type Spec = {
  number: number;
  customer: number;
  status: string;
  at: string;
  lines: { pick: number; ml: number; qty: number; name?: string }[];
  recipient?: { name: string; phone: string };
  typed?: string;
  comment?: string;
  gift?: string | null;
  promo?: { code: string; amount: number };
  tracking?: string;
  receipts?: ReceiptSpec[];
  steps?: Step[];
  /** How the confirming credit differs, and who linked it (default: exact, by the AI). */
  link?: { deltaTiyin?: number; card?: string; reason?: string; staff?: number };
  spare?: Spare[];
  /** Refunds staff recorded (#40): a share of the total, rounded down to 1 000 so'm. */
  refunds?: { share: number; at: string; reason: string; staff: number }[];
};

const AUDIT: Record<string, string> = {
  submit_receipt: 'order.receipt_submitted',
  confirm_payment: 'order.payment_confirmed',
  reject_receipt: 'order.receipt_rejected',
  payment_not_found: 'order.payment_not_found',
  accept: 'order.accepted',
  start_assembly: 'order.assembling',
  hand_to_bts: 'order.handed_to_bts',
  deliver: 'order.delivered',
  return: 'order.returned',
  cancel: 'order.cancelled',
};

/** Minutes after `iso`, as ISO. */
const plus = (iso: string, minutes: number) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

/**
 * The fulfilment path from «Ожидает оплаты» up to `to`: the receipt, the AI's confirmation, then a
 * manager's steps, each a few minutes or hours after the last.
 */
function walk(at: string, to: string, manager: number, tracking = 'BTS 4471 0098'): Step[] {
  const path: [string, string, string, Actor, number, Record<string, unknown>?][] = [
    ['submit_receipt', 'awaiting_payment', 'receipt_review', { type: 'customer' }, 9],
    ['confirm_payment', 'receipt_review', 'payment_confirmed', { type: 'ai' }, 3],
    ['accept', 'payment_confirmed', 'accepted', { type: 'staff', staff: manager }, 40],
    ['start_assembly', 'accepted', 'assembling', { type: 'staff', staff: manager }, 25],
    [
      'hand_to_bts',
      'assembling',
      'handed_to_bts',
      { type: 'staff', staff: manager },
      180,
      { trackingNumber: tracking },
    ],
    ['deliver', 'handed_to_bts', 'delivered', { type: 'staff', staff: manager }, 1900],
  ];
  const steps: Step[] = [];
  let when = at;
  for (const [action, from, next, by, after, payload] of path) {
    when = plus(when, after);
    steps.push({ action, from, to: next, at: when, by, ...(payload ? { payload } : {}) });
    if (next === to) return steps;
  }
  return steps;
}

/** A bank app's «перевод выполнен» screen, drawn in the browser: shot data only. */
function receiptHtml(amount: number, at: string, bank: string) {
  const sum = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const d = new Date(new Date(at).getTime() + 5 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const when = `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return `<!doctype html><html><body style="margin:0;font:15px/1.4 system-ui,sans-serif;background:#eef1f6;color:#1d2433">
  <div style="width:360px;height:720px;box-sizing:border-box;padding:28px 22px">
    <div style="font-weight:700;font-size:17px;margin-bottom:28px">${bank}</div>
    <div style="width:64px;height:64px;border-radius:32px;background:#2fb36d;margin:0 auto 14px;display:grid;place-items:center;color:#fff;font-size:34px">✓</div>
    <div style="text-align:center;font-size:16px;color:#55607a">Перевод выполнен</div>
    <div style="text-align:center;font-size:30px;font-weight:700;margin:6px 0 26px">${sum},00 UZS</div>
    <div style="background:#fff;border-radius:14px;padding:6px 16px">
      ${[
        ['Дата и время', when],
        ['Карта получателя', '9860 **** **** 7364'],
        ['Получатель', 'RAHIMOVA SEVARA'],
        ['Карта отправителя', 'HUMO **** 5521'],
        ['Комиссия', '0,00 UZS'],
        ['Номер операции', String(70_000_000 + (amount % 9_999_999))],
      ]
        .map(
          ([k, v]) =>
            `<div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #edf0f5"><span style="color:#7a8399">${k}</span><span style="font-weight:600">${v}</span></div>`,
        )
        .join('')}
    </div>
  </div></body></html>`;
}

/**
 * Shot data for the orders panel (#33): four customers and twelve orders, one in each state the
 * order page has to show, plus the worst case (twelve lines, a 60-character name, seven-digit
 * totals, five receipts, a typed address and a long comment), with their history, audit entries
 * and receipt images, and a handful of Humo credits, none linked yet, two marked «Не для заказа»
 * (#49). A returned order carries a
 * partial Refund and a delivered one of three lines with a promo code waits for its return
 * dialog (#40), as does a delivered worst case of twelve lines (the return dialog at its
 * longest). Replaced on every run.
 */
export async function seedShotOrders(db: Sql, filesDir: string) {
  await forgetShotOrders(db);

  const staff = new Map(
    (
      await db.query(`select id, telegram_id from staff where telegram_id = any($1::bigint[])`, [
        [990000002, 990000003],
      ])
    ).rows.map((r) => [Number(r.telegram_id), Number(r.id)]),
  );
  const dilnoza = staff.get(990000002)!;
  const muhammadjon = staff.get(990000003)!;

  const customer = new Map<number, number>();
  for (const c of CUSTOMERS) {
    const { rows } = await db.query(
      `insert into customers (telegram_id, first_name, last_name, username, language, phone, phone_verified_at, data_consent_at)
       values ($1, $2, $3, $4, $5, $6, now(), now())
       on conflict (telegram_id) do update set first_name = excluded.first_name, last_name = excluded.last_name,
         username = excluded.username, language = excluded.language, phone = excluded.phone
       returning id`,
      [c.tg, c.first, c.last, c.username, c.lang, c.phone],
    );
    customer.set(c.tg, Number(rows[0]!.id));
  }

  const volumes = (
    await db.query(
      `select f.id as fragrance_id, f.slug, f.name, f.original_brand, v.id as volume_id, v.ml, v.price, v.photo_hash
       from fragrances f join volumes v on v.fragrance_id = f.id
       where not f.hidden order by f.slug, v.ml`,
    )
  ).rows;
  const pickVolume = (pick: number, ml: number) => {
    const all = volumes.filter((v) => Number(v.ml) === ml);
    return all[pick % all.length]!;
  };
  const points = (
    await db.query(
      `select p.*, r.name_ru, r.name_uz, r.delivery_tariff from bts_points p join regions r on r.id = p.region_id
       where p.active order by r.position, p.code limit 40`,
    )
  ).rows;
  const regions = (await db.query(`select * from regions order by position`)).rows;

  const at = (day: number, hh: number, mm: number) =>
    // Tashkent wall clock on 2026-11-<day>, stored as UTC
    new Date(Date.UTC(2026, 10, day, hh - 5, mm)).toISOString();
  const ali = 990000101;
  const dil = 990000102;
  const long = 990000103;
  const jasur = 990000104;
  const reviewAt = at(10, 19, 40);
  const worstAt = at(9, 11, 5);

  const specs: Spec[] = [
    {
      number: 9001,
      customer: ali,
      status: 'awaiting_payment',
      at: at(11, 9, 12),
      lines: [{ pick: 3, ml: 30, qty: 1 }],
      spare: [
        { afterMin: 18, from: 'CLICK P2P HUMO2UZCAR' },
        { afterMin: 26, deltaTiyin: -500_000, from: 'PAYNET P2P' },
      ],
    },
    {
      number: 9002,
      customer: dil,
      status: 'receipt_review',
      at: at(11, 8, 30),
      lines: [
        { pick: 7, ml: 10, qty: 2 },
        { pick: 11, ml: 30, qty: 1 },
      ],
      recipient: { name: 'Sardor Yusupov', phone: '+998974445566' },
      receipts: [
        {
          at: at(11, 8, 41),
          verdict: 'pending',
          file: 'IMG_2041.PNG',
          source: 'miniapp',
          amount: 0,
        },
      ],
      steps: [
        {
          action: 'submit_receipt',
          from: 'awaiting_payment',
          to: 'receipt_review',
          at: at(11, 8, 41),
          by: { type: 'customer' },
        },
      ],
    },
    {
      number: 9003,
      customer: ali,
      status: 'receipt_review',
      at: reviewAt,
      lines: [
        { pick: 5, ml: 50, qty: 1 },
        { pick: 14, ml: 10, qty: 1 },
      ],
      comment: 'Позвоните, пожалуйста, после 18:00.',
      promo: { code: 'LUMMI10', amount: 0 },
      receipts: [
        {
          at: plus(reviewAt, 14),
          verdict: 'rejected',
          file: 'Screenshot_20261110_195312.jpg',
          source: 'miniapp',
          amount: -40_000,
        },
        {
          at: plus(reviewAt, 52),
          verdict: 'manual_review',
          file: 'Click_chek.png',
          source: 'bot',
          amount: 0,
          reviewReason: 'not_confirmed',
          check: {
            isReceipt: 0.97,
            amountMatches: 0.55,
            recipientMatches: 0.91,
            choiceConfidence: 0.42,
            confirmed: false,
            outcome: 'manual_review',
            reason: 'below threshold',
          },
        },
      ],
      spare: [
        { afterMin: 50, from: 'CLICK P2P HUMO2UZCAR' },
        { afterMin: 12, deltaTiyin: -4_000_000, from: 'CLICK P2P HUMO2UZCAR' },
        { afterMin: 58, card: '9055', from: 'UZCARD2HUMO P2P' },
        { afterMin: 61, deltaTiyin: 50, from: 'PAYNET P2P' },
      ],
      steps: [
        {
          action: 'submit_receipt',
          from: 'awaiting_payment',
          to: 'receipt_review',
          at: plus(reviewAt, 14),
          by: { type: 'customer' },
        },
        {
          action: 'reject_receipt',
          from: 'receipt_review',
          to: 'awaiting_payment',
          at: plus(reviewAt, 31),
          by: { type: 'staff', staff: dilnoza },
          reason: 'amount_mismatch',
          payload: {
            note: 'В чеке 144 000 сум, а к переводу больше. Переведите недостающую сумму и пришлите оба чека.',
          },
        },
        {
          action: 'submit_receipt',
          from: 'awaiting_payment',
          to: 'receipt_review',
          at: plus(reviewAt, 52),
          by: { type: 'customer' },
        },
      ],
    },
    {
      number: 9004,
      customer: dil,
      status: 'payment_confirmed',
      at: at(10, 16, 5),
      lines: [{ pick: 2, ml: 50, qty: 1 }],
      gift: 'Tugʻilgan kuningiz bilan! Bu atir sizga yozni eslatsin.',
      receipts: [
        {
          at: at(10, 16, 14),
          verdict: 'ai_confirmed',
          file: 'chek.jpg',
          source: 'miniapp',
          amount: 0,
          check: SURE,
        },
      ],
      steps: walk(at(10, 16, 5), 'payment_confirmed', dilnoza),
    },
    {
      number: 9005,
      customer: jasur,
      status: 'handed_to_bts',
      at: at(9, 14, 20),
      lines: [
        { pick: 9, ml: 30, qty: 1 },
        { pick: 21, ml: 10, qty: 1 },
      ],
      tracking: 'UZB 7704 1129 0042',
      receipts: [
        {
          at: at(9, 14, 29),
          verdict: 'ai_confirmed',
          file: 'IMG_7731.PNG',
          source: 'miniapp',
          amount: 0,
          check: SURE,
        },
      ],
      steps: walk(at(9, 14, 20), 'handed_to_bts', muhammadjon, 'UZB 7704 1129 0042'),
    },
    {
      number: 9006,
      customer: ali,
      status: 'delivered',
      at: at(6, 12, 0),
      lines: [{ pick: 1, ml: 30, qty: 2 }],
      tracking: 'UZB 7704 0981 0017',
      receipts: [
        {
          at: at(6, 12, 9),
          verdict: 'manager_confirmed',
          file: 'IMG_6620.PNG',
          source: 'miniapp',
          amount: 5_000,
          reviewReason: 'not_confirmed',
          check: {
            isReceipt: 0.98,
            amountMatches: 0.12,
            recipientMatches: 0.95,
            choiceConfidence: 0.31,
            confirmed: false,
            outcome: 'manual_review',
            provider: 'openai',
            reason: 'below threshold',
          },
        },
      ],
      steps: walk(at(6, 12, 0), 'delivered', dilnoza, 'UZB 7704 0981 0017'),
      link: {
        deltaTiyin: 500_000,
        staff: dilnoza,
        reason: 'Перевели на 5 000 сум больше: разницу вернём наличными с посылкой.',
      },
    },
    {
      number: 9007,
      customer: dil,
      status: 'cancelled',
      at: at(8, 10, 15),
      lines: [{ pick: 13, ml: 50, qty: 1 }],
      receipts: [
        {
          at: at(8, 10, 24),
          verdict: 'ai_confirmed',
          file: 'chek_8_noyabr.png',
          source: 'bot',
          amount: 0,
          check: SURE,
        },
      ],
      steps: [
        ...walk(at(8, 10, 15), 'accepted', muhammadjon),
        {
          action: 'cancel',
          from: 'accepted',
          to: 'cancelled',
          at: at(8, 12, 2),
          by: { type: 'staff', staff: muhammadjon },
          reason: 'out_of_stock',
          payload: { note: 'Последний флакон 50 мл оказался с трещиной.' },
        },
      ],
    },
    {
      number: 9008,
      customer: long,
      status: 'receipt_review',
      at: worstAt,
      lines: [
        { pick: 0, ml: 50, qty: 3, name: WORST_LINE_NAME },
        ...Array.from({ length: 11 }, (_, i) => ({
          pick: 20 + i * 3,
          ml: [10, 30, 50][i % 3]!,
          qty: (i % 4) + 1,
        })),
      ],
      recipient: {
        name: 'Abdurakhmanova-Ivanovskaya Aleksandra-Konstantina',
        phone: '+998977654321',
      },
      typed:
        'Ташкентская обл., Зангиатинский р-н, массив Эшонгузар, ул. Навбахор, 17, ориентир — новая мечеть',
      comment:
        'Это подарок на юбилей мамы: пожалуйста, упакуйте каждый флакон отдельно и не вкладывайте чек. Если какого-то аромата нет, позвоните — заменим на похожий. Звонить лучше вечером, после 19:00.',
      gift: 'Дорогая мама! С юбилеем! Пусть каждый день пахнет садом после дождя, а рядом будут те, кого вы любите. Ваши дети и внуки.',
      receipts: [
        {
          at: plus(worstAt, 20),
          verdict: 'rejected',
          file: 'Screenshot_2026-11-09-11-25-04-118_uz.paynet.app.jpg',
          source: 'miniapp',
          amount: -1_000_000,
        },
        {
          at: plus(worstAt, 70),
          verdict: 'rejected',
          file: 'chek.pdf',
          source: 'miniapp',
          pdf: true,
          amount: 0,
        },
        {
          at: plus(worstAt, 140),
          verdict: 'rejected',
          file: 'photo_2026-11-09_13-25.jpg',
          source: 'bot',
          amount: 0,
        },
        {
          at: plus(worstAt, 260),
          verdict: 'payment_not_found',
          file: 'IMG_9921.PNG',
          source: 'miniapp',
          amount: 0,
        },
        {
          at: plus(worstAt, 400),
          verdict: 'manual_review',
          file: 'IMG_9930.PNG',
          source: 'miniapp',
          amount: 0,
          reviewReason: 'duplicate',
        },
      ],
      spare: [{ afterMin: 395, from: 'UZCARD2HUMO P2P TRANSFER FROM APELSIN MOBILE BANKING' }],
      steps: [
        {
          action: 'submit_receipt',
          from: 'awaiting_payment',
          to: 'receipt_review',
          at: plus(worstAt, 20),
          by: { type: 'customer' },
        },
        {
          action: 'reject_receipt',
          from: 'receipt_review',
          to: 'awaiting_payment',
          at: plus(worstAt, 45),
          by: { type: 'staff', staff: muhammadjon },
          reason: 'amount_mismatch',
        },
        {
          action: 'submit_receipt',
          from: 'awaiting_payment',
          to: 'receipt_review',
          at: plus(worstAt, 70),
          by: { type: 'customer' },
        },
        {
          action: 'reject_receipt',
          from: 'receipt_review',
          to: 'awaiting_payment',
          at: plus(worstAt, 95),
          by: { type: 'staff', staff: dilnoza },
          reason: 'wrong_card',
          payload: {
            note: 'Перевод ушёл на карту 8600 **** 9055 — это старая карта магазина, её больше нет.',
          },
        },
        {
          action: 'submit_receipt',
          from: 'awaiting_payment',
          to: 'receipt_review',
          at: plus(worstAt, 140),
          by: { type: 'customer' },
        },
        {
          action: 'reject_receipt',
          from: 'receipt_review',
          to: 'awaiting_payment',
          at: plus(worstAt, 160),
          by: { type: 'staff', staff: muhammadjon },
          reason: 'other',
          payload: {
            note: 'На фото экран другого перевода от 2 ноября: сумма, дата и получатель не совпадают с этим заказом. Пожалуйста, пришлите скриншот именно этого перевода из приложения банка, целиком, вместе с датой, временем и картой получателя — тогда мы проверим его быстрее.',
          },
        },
        {
          action: 'submit_receipt',
          from: 'awaiting_payment',
          to: 'receipt_review',
          at: plus(worstAt, 260),
          by: { type: 'customer' },
        },
        {
          action: 'payment_not_found',
          from: 'receipt_review',
          to: 'awaiting_payment',
          at: plus(worstAt, 380),
          by: { type: 'system' },
        },
        {
          action: 'submit_receipt',
          from: 'awaiting_payment',
          to: 'receipt_review',
          at: plus(worstAt, 400),
          by: { type: 'customer' },
        },
      ],
    },
    {
      number: 9009,
      customer: jasur,
      status: 'cancelled',
      at: at(7, 20, 45),
      lines: [{ pick: 17, ml: 10, qty: 1 }],
      steps: [
        {
          action: 'cancel',
          from: 'awaiting_payment',
          to: 'cancelled',
          at: at(8, 8, 45),
          by: { type: 'system' },
          reason: 'reserve_expired',
        },
      ],
    },
    {
      number: 9010,
      customer: long,
      status: 'assembling',
      at: at(10, 9, 50),
      lines: [{ pick: 26, ml: 30, qty: 1 }],
      receipts: [
        {
          at: at(10, 9, 58),
          verdict: 'ai_confirmed',
          file: 'IMG_8812.PNG',
          source: 'miniapp',
          amount: 0,
          check: SURE,
        },
      ],
      steps: walk(at(10, 9, 50), 'assembling', dilnoza),
    },
    {
      number: 9011,
      customer: ali,
      status: 'returned',
      at: at(5, 11, 30),
      lines: [
        { pick: 4, ml: 30, qty: 2 },
        { pick: 8, ml: 50, qty: 1 },
        { pick: 15, ml: 10, qty: 1 },
      ],
      tracking: 'UZB 7704 0950 0031',
      receipts: [
        {
          at: at(5, 11, 41),
          verdict: 'ai_confirmed',
          file: 'IMG_5102.PNG',
          source: 'miniapp',
          amount: 0,
          check: SURE,
        },
      ],
      steps: [
        ...walk(at(5, 11, 30), 'delivered', dilnoza, 'UZB 7704 0950 0031'),
        {
          action: 'return',
          from: 'delivered',
          to: 'returned',
          at: at(9, 17, 20),
          by: { type: 'staff', staff: muhammadjon },
          reason:
            'Покупатель вернул посылку целиком: флакон 50 мл протёк в дороге, остальное в заводской упаковке.',
          payload: {
            lines: [
              { position: 0, backToStock: true },
              { position: 1, backToStock: false },
              { position: 2, backToStock: true },
            ],
          },
        },
      ],
      refunds: [
        {
          share: 0.4,
          at: at(10, 10, 5),
          reason: 'Перевели на карту покупателя за протёкший флакон 50 мл.',
          staff: dilnoza,
        },
      ],
    },
    {
      number: 9012,
      customer: dil,
      status: 'delivered',
      at: at(7, 15, 40),
      lines: [
        { pick: 6, ml: 30, qty: 1 },
        { pick: 10, ml: 10, qty: 2 },
        { pick: 19, ml: 50, qty: 1 },
      ],
      promo: { code: 'LUMMI10', amount: 0 },
      tracking: 'UZB 7704 1003 0078',
      receipts: [
        {
          at: at(7, 15, 52),
          verdict: 'ai_confirmed',
          file: 'chek_7_noyabr.jpg',
          source: 'bot',
          amount: 0,
          check: SURE,
        },
      ],
      steps: walk(at(7, 15, 40), 'delivered', muhammadjon, 'UZB 7704 1003 0078'),
    },
    {
      // the return dialog at its worst (#40): twelve lines, a 60-character name, seven-digit money
      number: 9013,
      customer: long,
      status: 'delivered',
      at: at(4, 10, 15),
      lines: [
        { pick: 0, ml: 50, qty: 3, name: WORST_LINE_NAME },
        ...Array.from({ length: 11 }, (_, i) => ({
          pick: 21 + i * 3,
          ml: [50, 30, 10][i % 3]!,
          qty: (i % 4) + 1,
        })),
      ],
      promo: { code: 'LUMMI10', amount: 0 },
      tracking: 'UZB 7704 0412 0090',
      receipts: [
        {
          at: at(4, 10, 31),
          verdict: 'ai_confirmed',
          file: 'IMG_4410.PNG',
          source: 'miniapp',
          amount: 0,
          check: SURE,
        },
      ],
      steps: walk(at(4, 10, 15), 'delivered', dilnoza, 'UZB 7704 0412 0090'),
    },
  ];

  const SHOP_LAST4 = '7364';
  let humo = HUMO_FIRST;
  /** A credit as the Humo intake writes one; returns its id. */
  const credit = async (occurred: string, tiyin: number, last4: string, from: string | null) => {
    const id = humo++;
    await db.query(
      `insert into humo_messages (message_id, text, received_at) values ($1, 'shot', $2)`,
      [id, occurred],
    );
    const { rows } = await db.query(
      `insert into credits (humo_message_id, amount_tiyin, occurred_at, card_mask, card_last4, counterparty, event_handled_at)
       values ($1, $2, date_trunc('minute', $3::timestamptz), $4, $5, $6, now()) returning id`,
      [id, tiyin, occurred, `HUMOCARD *${last4}`, last4, from],
    );
    return Number(rows[0]!.id);
  };

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 360, height: 720 },
    deviceScaleFactor: 2,
  });
  const dir = resolve(filesDir, 'private/receipts');
  mkdirSync(dir, { recursive: true });
  try {
    for (const [index, s] of specs.entries()) {
      const point = s.typed ? null : points[(index * 7) % points.length]!;
      // a typed address is in Tashkent region (the text says so)
      const region =
        point ?? regions.find((r) => String(r.name_ru).startsWith('Ташкентская')) ?? regions[0]!;
      const lines = s.lines.map((l, position) => {
        const v = pickVolume(l.pick, l.ml);
        const price = Number(v.price);
        return { ...l, v, position, price, total: price * l.qty };
      });
      const items = lines.reduce((n, l) => n + l.total, 0);
      const discount = s.promo ? Math.round(items * 0.1) : 0;
      const after = items - discount;
      const fee = after >= 250_000 ? 0 : Number(region.delivery_tariff ?? 25_000);
      const total = after + fee;
      const status = s.status;
      const { rows } = await db.query(
        `insert into orders (number, customer_id, status, reserve_until, recipient_name, recipient_phone, region_id,
           region_name_ru, region_name_uz, bts_point_id, point_code, point_name, point_city, point_address,
           point_landmark, point_hours, typed_address, comment, is_gift, gift_message, items_subtotal, discount,
           discount_amount, delivery_fee, threshold_base, threshold_base_amount, total, amount_due,
           idempotency_key, tracking_number, created_at, updated_at)
         overriding system value
         values ($1, $2, $3, $4::timestamptz + interval '12 hours', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, 'after', $25, $26, $26, $27, $28, $4, $4)
         returning id`,
        [
          s.number,
          customer.get(s.customer),
          status,
          s.at,
          s.recipient?.name ?? `${CUSTOMERS.find((c) => c.tg === s.customer)!.first}`,
          s.recipient?.phone ?? CUSTOMERS.find((c) => c.tg === s.customer)!.phone,
          point ? point.region_id : region.id,
          region.name_ru,
          region.name_uz,
          point?.id ?? null,
          point?.code ?? null,
          point?.name ?? null,
          point?.city ?? null,
          point?.address ?? null,
          point?.landmark ?? null,
          point?.hours ?? null,
          s.typed ?? null,
          s.comment ?? null,
          s.gift !== undefined,
          s.gift ?? null,
          items,
          s.promo
            ? JSON.stringify({ type: 'promo_code', code: s.promo.code, amount: discount })
            : null,
          discount,
          fee,
          after,
          total,
          randomUUID(),
          s.tracking ?? null,
        ],
      );
      const orderId = Number(rows[0]!.id);
      for (const l of lines) {
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
            l.name ?? l.v.name,
            l.v.original_brand,
            l.ml,
            l.v.photo_hash,
            l.price,
            l.qty,
            l.total,
          ],
        );
      }
      await audit(
        db,
        { type: 'customer', id: customer.get(s.customer)! },
        'order.created',
        orderId,
        s.at,
        {
          number: s.number,
          total,
          status: 'awaiting_payment',
        },
      );

      const spareIds: number[] = [];
      for (const c of s.spare ?? [])
        spareIds.push(
          await credit(
            plus(s.at, c.afterMin),
            total * 100 + (c.deltaTiyin ?? 0),
            c.card ?? SHOP_LAST4,
            c.from ?? null,
          ),
        );

      const receiptIds: number[] = [];
      for (const r of s.receipts ?? []) {
        await page.setContent(
          receiptHtml(total + r.amount, r.at, r.source === 'bot' ? 'Paynet' : 'Click'),
        );
        const png = await page.screenshot({ type: 'png' });
        const name = randomUUID();
        const normalized = `private/receipts/${name}.judge.png`;
        const original = r.pdf ? `private/receipts/${name}.pdf` : `private/receipts/${name}.png`;
        writeFileSync(resolve(filesDir, normalized), png);
        writeFileSync(
          resolve(filesDir, original),
          r.pdf ? await page.pdf({ width: '360px', height: '720px' }) : png,
        );
        const { rows: made } = await db.query(
          `insert into receipts (order_id, source, verdict, file_name, kind, size, original_key, normalized_key,
             normalized_mime, width, height, sha256, phash, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'image/png', 720, 1440, encode(sha256($9::bytea), 'hex'), $10, $11)
           returning id`,
          [
            orderId,
            r.source,
            r.verdict,
            r.file,
            r.pdf ? 'pdf' : 'png',
            png.length,
            original,
            normalized,
            Buffer.from(name),
            name.replace(/-/g, '').slice(0, 16),
            r.at,
          ],
        );
        receiptIds.push(Number(made[0]!.id));
        if (r.reviewReason)
          await db.query(`update receipts set review_reason = $2 where id = $1`, [
            made[0]!.id,
            r.reviewReason,
          ]);
      }
      let linkedCredit: number | null = null;

      let submitted = -1;
      for (const step of s.steps ?? []) {
        if (step.action === 'submit_receipt') submitted++;
        const receiptId =
          step.action === 'submit_receipt' || step.action === 'reject_receipt'
            ? receiptIds[submitted]
            : undefined;
        let payload: Record<string, unknown> = {
          ...(step.payload ?? {}),
          ...(receiptId ? { receiptId } : {}),
        };
        if (step.action === 'confirm_payment') {
          // the money came a couple of minutes before; #32's door links it (orders.credit_id)
          const delta = s.link?.deltaTiyin ?? 0;
          const last4 = s.link?.card ?? SHOP_LAST4;
          linkedCredit = await credit(
            plus(step.at, -2),
            total * 100 + delta,
            last4,
            'CLICK P2P HUMO2UZCAR',
          );
          await db.query(`update orders set credit_id = $2 where id = $1`, [orderId, linkedCredit]);
          payload = {
            creditId: linkedCredit,
            receiptId: receiptIds[submitted] ?? null,
            amountDue: total,
            creditAmountTiyin: total * 100 + delta,
            differenceTiyin: delta,
            cardLast4: last4,
            offShopCard: last4 !== SHOP_LAST4,
          };
          if (s.link?.staff) {
            step.by = { type: 'staff', staff: s.link.staff };
            step.reason = s.link.reason;
          }
        }
        const actorId =
          step.by.type === 'customer'
            ? customer.get(s.customer)!
            : step.by.type === 'staff'
              ? step.by.staff!
              : null;
        await db.query(
          `insert into order_events (order_id, from_status, to_status, action, actor_type, actor_id, reason, payload, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            orderId,
            step.from,
            step.to,
            step.action,
            step.by.type,
            actorId,
            step.reason ?? null,
            JSON.stringify(payload),
            step.at,
          ],
        );
        await audit(
          db,
          { type: step.by.type, id: actorId },
          AUDIT[step.action]!,
          orderId,
          step.at,
          {
            number: s.number,
            from: step.from,
            to: step.to,
            ...(step.reason ? { reason: step.reason } : {}),
            ...payload,
          },
        );
      }

      // the Refunds staff recorded (#40), each audited with what was paid and refunded before
      let refundedBefore = 0;
      for (const r of s.refunds ?? []) {
        const amount = Math.floor((total * r.share) / 1000) * 1000;
        const day = new Date(new Date(r.at).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
        await db.query(
          `insert into refunds (order_id, amount, refunded_on, reason, staff_id, created_at)
           values ($1, $2, $3, $4, $5, $6)`,
          [orderId, amount, day, r.reason, r.staff, r.at],
        );
        await audit(db, { type: 'staff', id: r.staff }, 'order.refunded', orderId, r.at, {
          number: s.number,
          amount,
          date: day,
          reason: r.reason,
          paid: total,
          refundedBefore,
        });
        refundedBefore += amount;
      }

      // the receipt AI's answers (#32): shown the credit that paid it, or the first one waiting
      for (const [i, r] of (s.receipts ?? []).entries()) {
        const shown = linkedCredit ?? spareIds[0];
        if (!r.check || shown === undefined) continue;
        const { provider = 'typesafe', outcome, reason, ...scores } = r.check;
        await db.query(
          `insert into receipt_checks (receipt_id, candidate_credit_ids, judgement, outcome, created_at)
           values ($1, $2, $3, $4, $5::timestamptz + interval '1 minute')`,
          [
            receiptIds[i],
            [shown, ...spareIds.slice(1, 2)],
            JSON.stringify({
              ...scores,
              chosenCreditId: r.check.confirmed ? shown : null,
              provider,
              ...(reason ? { reason } : {}),
            }),
            outcome,
            r.at,
          ],
        );
      }
    }
  } finally {
    await browser.close();
  }

  // a few more credits nothing claims, as the Humo intake writes them
  for (const [occurred, tiyin, last4, from] of [
    ['2026-11-11T04:02:00Z', 18_800_000, SHOP_LAST4, 'CLICK P2P HUMO2UZCAR'],
    ['2026-11-11T03:41:00Z', 7_575_050, SHOP_LAST4, 'PAYNET P2P'],
    [
      '2026-11-10T15:12:00Z',
      125_000_000,
      '9055',
      'UZCARD2HUMO P2P TRANSFER FROM APELSIN MOBILE BANKING',
    ],
    ['2026-11-10T11:20:00Z', 14_900_000, SHOP_LAST4, 'CLICK P2P HUMO2UZCAR'],
    ['2026-11-09T09:00:00Z', 9_900_000, SHOP_LAST4, null],
  ] as const)
    await credit(occurred, tiyin, last4, from);

  // a personal transfer staff marked «Не для заказа» (#49), and one marked with no note
  for (const [occurred, tiyin, from, markedAt, note] of [
    [
      '2026-11-10T13:25:00Z',
      50_000_000,
      'CLICK P2P HUMO2UZCAR',
      '2026-11-10T13:40:00Z',
      'Личный перевод от брата владельца, к заказам отношения не имеет',
    ],
    ['2026-11-08T06:05:00Z', 2_000_000, 'PAYNET P2P', '2026-11-08T07:15:00Z', null],
  ] as const) {
    const id = await credit(occurred, tiyin, SHOP_LAST4, from);
    await db.query(
      `update credits set not_for_order_at = $2, not_for_order_by = $3, not_for_order_note = $4 where id = $1`,
      [id, markedAt, dilnoza, note],
    );
  }
}

async function audit(
  db: Sql,
  actor: { type: string; id: number | null },
  action: string,
  orderId: number,
  at: string,
  payload: Record<string, unknown>,
) {
  await db.query(
    `insert into audit_log (actor_type, actor_id, action, target_type, target_id, payload, created_at)
     values ($1, $2, $3, 'order', $4, $5, $6)`,
    [actor.type, actor.id, action, String(orderId), JSON.stringify(payload), at],
  );
}

/** Drops the shot orders (their lines, history, receipts and audit entries) and the shot credits. */
export async function forgetShotOrders(db: Sql) {
  const ids = (
    await db.query(`select id from orders where number between $1 and $2`, [FIRST, LAST])
  ).rows.map((r) => String(r.id));
  await db.query(
    `delete from audit_log where target_type = 'order' and target_id = any($1::text[])`,
    [ids],
  );
  await db.query(
    `delete from receipt_checks where receipt_id in (select id from receipts where order_id = any($1::bigint[]))`,
    [ids],
  );
  await db.query(`delete from receipts where order_id = any($1::bigint[])`, [ids]);
  await db.query(`delete from refunds where order_id = any($1::bigint[])`, [ids]);
  await db.query(`delete from orders where number between $1 and $2`, [FIRST, LAST]);
  await db.query(
    `delete from credits where humo_message_id >= $1 and humo_message_id < $1 + 1000`,
    [HUMO_FIRST],
  );
  await db.query(`delete from humo_messages where message_id >= $1 and message_id < $1 + 1000`, [
    HUMO_FIRST,
  ]);
}
