import { randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { signContact } from '@lummi/contracts/sign-contact';
import { SHOT_USER, type ApiClient, type ShotUser } from './api';
import { LIMIT_BANNER, LONG_PAGE, longSlogan, onInfoPage } from './content-data';
import { SHOT_CARD, type ShotDb } from './db';

/**
 * Every screen the screenshot run captures, in one place. Each UI ticket adds its screens here
 * (and a `setup` when the screen needs state, such as an item already in the cart).
 *
 * `path` is a real route of the app. Theme and language are NOT set here: the run saves them
 * through PATCH /me/preferences for each light/dark x RU/UZ combination, like the app does.
 */
export interface ScreenDef {
  /** File name stem: `<id>-<theme>-<lang>.png`. kebab-case. */
  id: string;
  path: string;
  /** Prepare server state for this screen, as the signed-in screenshot customer. */
  setup?: (ctx: { api: ApiClient; db: ShotDb }) => Promise<void>;
  /** Undo what `setup` changed in the database, so the next run starts from the seed. */
  teardown?: (ctx: { api: ApiClient; db: ShotDb }) => Promise<void>;
  /** Interact with the loaded page (open a sheet, type in a search) before the capture. */
  act?: (ctx: { page: Page; db: ShotDb }) => Promise<void>;
  /** Capture the loading state `act` left on screen: skeletons are expected, not waited out. */
  loading?: boolean;
  /** Sign in with initData this many seconds old (shows the "reopen the app" state). */
  initDataAgeSeconds?: number;
  /** Capture the whole scrolling page instead of the 390x844 viewport. */
  fullPage?: boolean;
  /** The `startapp` value the app is launched with (`l_<code>`, `p_<slug>`); the path is then `/`. */
  startParam?: string;
  /** Viewport width in CSS px (default 390): 360 for the narrow Android check. */
  width?: number;
  /** Take this screen as another customer (default `SHOT_USER`), e.g. one who never shared a phone. */
  user?: ShotUser;
}

/** Saves the screenshot customer's delivery city (needs `npm run bts:import` to have run). */
async function chooseCity(api: ApiClient, regionCode = 'Самаркандская', city = 'Самарканд') {
  const regions = await api.delivery.regions();
  if (regions.status !== 200) throw new Error(`regions: HTTP ${regions.status}`);
  const region = regions.body.find((r) => r.nameRu.startsWith(regionCode));
  if (!region) throw new Error(`no region "${regionCode}"`);
  const saved = await api.me.setDeliveryCity({ body: { regionId: region.id, city } });
  if (saved.status !== 200) throw new Error(`delivery city: HTTP ${saved.status} (run bts:import)`);
}
const forgetCity = async (api: ApiClient) => void (await api.me.clearDeliveryCity());

const sheet = (page: Page) => page.getByRole('dialog');
async function openCitySheet(page: Page) {
  await page.getByTestId('delivery-row').click();
  await sheet(page).waitFor();
}
/** Taps the n-th region row of the open sheet. */
async function pickRegion(page: Page, n: number) {
  await sheet(page).getByTestId('region-row').nth(n).click();
  await sheet(page).getByTestId('city-row').first().waitFor();
}
async function pickCityRow(page: Page, text: string) {
  await sheet(page).getByTestId('city-row').filter({ hasText: text }).first().click();
  await sheet(page).getByTestId('point-row').first().waitFor();
}

/** Empties the screenshot customer's cart, then adds the given volumes (slug, ml, qty). */
async function fillCart(api: ApiClient, items: [slug: string, ml: 10 | 30 | 50, qty?: number][]) {
  const now = await api.cart.get();
  if (now.status !== 200) throw new Error(`cart: HTTP ${now.status}`);
  for (const line of now.body.lines) await api.cart.removeLine({ params: { lineId: line.id } });
  for (const [slug, ml, qty = 1] of items) {
    const res = await api.cart.addLine({ body: { slug, ml, qty } });
    if (res.status !== 200) throw new Error(`add ${slug} ${ml}: HTTP ${res.status}`);
  }
}
const CART_SLUGS = ['symphony', 'tygar', 'ink-mark', 'power-of-you', 'baccarat-rouge-540'];
const emptyCart = async ({ api, db }: { api: ApiClient; db: ShotDb }) => {
  await fillCart(api, []);
  for (const slug of CART_SLUGS) await db.restore(slug);
};

/** BLOGER10, 10 % on items, no limits: the code the promo shots apply (#29). Written straight to
 * the dev DB, as the owner's admin would. */
async function shotPromo(db: ShotDb) {
  await db.query(
    `insert into promo_codes (code, kind, percent) values ('BLOGER10', 'percent', 10)
     on conflict (code) do update set kind = 'percent', percent = 10, amount = null,
       max_discount = null, expires_at = null, min_order_total = null, total_limit = null,
       per_customer_limit = null, new_customers_only = false, applies_to_marked_down = false,
       active = true`,
  );
}
/** The longest code the admin allows, 32 characters (break-ui, #29); not one the admin shots seed. */
const SHOT_LONG_CODE = 'MALIKA_BLOGER_YANGI_YIL_2026_UZB';
/** Takes the code out of the cart and forgets the typed attempts and their settings. */
async function forgetPromo({ api, db }: { api: ApiClient; db: ShotDb }) {
  await api.cart.removePromoCode();
  await db.query(`delete from settings where key in ('promo.attemptLimit')`);
  await db.query(`update carts set promo_attempts = 0, promo_attempts_since = null`);
}
async function typePromo(page: Page, code: string) {
  await page.getByTestId('promo-input').fill(code);
}

/** A campaign link for BLOGER10 (#35), written as the owner's admin would; `active` shapes the code. */
async function shotCampaign(db: ShotDb, opts: { promoActive: boolean }) {
  await shotPromo(db);
  await db.query(`update promo_codes set active = $1 where code = 'BLOGER10'`, [opts.promoActive]);
  await db.query(
    `insert into campaign_links (code, target, promo_code_id, source, source_label)
     values ('malika-nov', 'p_symphony', (select id from promo_codes where code = 'BLOGER10'), 'blogger', 'Malika')
     on conflict do nothing`,
  );
}
async function forgetCampaign({ api, db }: { api: ApiClient; db: ShotDb }) {
  await db.query(`update customers set acquisition_link_id = null`);
  await db.query(`delete from campaign_opens`);
  await db.query(`update orders set campaign_link_id = null`);
  await db.query(`delete from campaign_links where code = 'malika-nov'`);
  await db.query(`update promo_codes set active = true where code = 'BLOGER10'`);
  await forgetPromo({ api, db });
  await emptyCart({ api, db });
}

/** Taps the first n fragrances of the builder's list. */
function pickForBuilder(n: number) {
  return async ({ page }: { page: Page }) => {
    const picks = page.getByTestId('pick');
    await picks.first().waitFor();
    for (let i = 0; i < n; i++) await picks.nth(i).click();
  };
}

/** Types a search and submits it, as the keyboard's «Найти» does. */
async function searchFor(page: Page, text: string) {
  const box = page.getByRole('searchbox');
  await box.fill(text);
  await box.press('Enter');
}

/** The dev fixture routes carry a data toggle; it is chrome, not part of the screen. */
const hideFixtureToggle = async ({ page }: { page: Page }) =>
  void (await page.addStyleTag({ content: 'nav[aria-label="fixture"] { display: none }' }));

/** A customer who has not shared the contact yet (Profile shows the «Добавить» row). */
const NO_PHONE_USER: ShotUser = {
  id: 700_000_002,
  first_name: 'Javohir',
  username: 'javohir_t',
  language_code: 'uz',
};

/** A customer whose Telegram phone is Russian: not an allowed Recipient country by default. */
const FOREIGN_PHONE_USER: ShotUser = {
  id: 700_000_003,
  first_name: 'Anna',
  last_name: 'Sokolova',
  language_code: 'ru',
};

/** Every state of the registration sheet, on its dev route (no Telegram call). */
const registrationStates: ScreenDef[] = (
  [
    ['initial', 'idle'],
    ['waiting', 'busy'],
    ['done', 'done&bot=1'],
    ['done-in-app', 'done&bot=0'],
    ['denied', 'denied'],
    ['failed', 'failed'],
    ['foreign', 'foreign'],
    ['expired', 'expired'],
    ['taken', 'taken'],
    ['update-telegram', 'unsupported'],
    ['browser', 'browser'],
  ] as const
).map(([id, state]) => ({ id: `registration-${id}`, path: `/dev/registration?state=${state}` }));

/** The screenshot customer's account phone from a signed contact, as the registration step saves it. */
async function sharePhone(api: ApiClient, userId = SHOT_USER.id, phone = '+998901234567') {
  const res = await api.me.shareContact({
    body: {
      proof: signContact({
        botToken: process.env.BOT_TOKEN ?? '',
        userId,
        phone,
        authDate: Math.floor(Date.now() / 1000),
      }),
    },
  });
  if (res.status !== 200) throw new Error(`share contact failed ${res.status}`);
}

/** Removes the shot customers' orders (their lines are the reserve) and, optionally, their consent. */
async function clearOrders(db: ShotDb, { consent }: { consent?: 'given' | 'none' } = {}) {
  const ids = [SHOT_USER.id, NO_PHONE_USER.id, FOREIGN_PHONE_USER.id];
  const theirs = `select id from orders where customer_id in (select id from customers where telegram_id = any($1))`;
  // a receipt keeps its order (no cascade): it goes first; a held birthday coupon lets go (#30)
  await db.query(`delete from receipts where order_id in (${theirs})`, [ids]);
  await db.query(
    `update birthday_coupons set used_by_order_id = null where used_by_order_id in (${theirs})`,
    [ids],
  );
  // an upgrade right goes with the order that opened it, and lets go of the one that held it (#38)
  await db.query(
    `update upgrade_rights set used_by_order_id = null where used_by_order_id in (${theirs})`,
    [ids],
  );
  await db.query(`delete from upgrade_rights where source_order_id in (${theirs})`, [ids]);
  await db.query(`delete from orders where id in (${theirs})`, [ids]);
  if (consent)
    await db.query(`update customers set data_consent_at = $2 where telegram_id = any($1)`, [
      ids,
      consent === 'given' ? new Date() : null,
    ]);
}

/** The first offered point of the saved city (Samarkand). */
async function firstPoint(api: ApiClient) {
  const regions = await api.delivery.regions();
  if (regions.status !== 200) throw new Error(`regions: HTTP ${regions.status}`);
  const region = regions.body.find((r) => r.nameRu.startsWith('Самаркандская'))!;
  const points = await api.delivery.points({ query: { regionId: region.id, city: 'Самарканд' } });
  if (points.status !== 200 || !points.body[0]) throw new Error('no point (run bts:import)');
  return { region, point: points.body[0] };
}

/** Places an order through the real API, at the total checkout quotes. */
async function placeOrder(
  api: ApiClient,
  items: [slug: string, ml: 10 | 30 | 50, qty?: number][],
  extra: {
    gift?: boolean;
    giftMessage?: string;
    comment?: string;
    recipientName?: string;
    /** A typed address in the point's region instead of the point. */
    typed?: string;
    /** Fills the cart itself (set lines), instead of the volumes in `items`. */
    fill?: (api: ApiClient) => Promise<void>;
  } = {},
) {
  if (extra.fill) await extra.fill(api);
  else await fillCart(api, items);
  const { region, point } = await firstPoint(api);
  const checkout = await api.checkout.get({ query: { regionId: region.id } });
  if (checkout.status !== 200) throw new Error(`checkout: HTTP ${checkout.status}`);
  const res = await api.orders.create({
    body: {
      recipientName: 'Dilnoza Karimova',
      recipientPhone: '+998901234567',
      delivery: extra.typed
        ? { kind: 'typed', regionId: region.id, text: extra.typed }
        : { kind: 'point', pointId: point.id },
      consent: true,
      confirmedTotal: checkout.body.quote.total,
      confirmedDiscount: checkout.body.quote.discount,
      idempotencyKey: randomUUID(),
      gift: extra.gift,
      giftMessage: extra.giftMessage,
      comment: extra.comment,
      ...(extra.recipientName ? { recipientName: extra.recipientName } : {}),
    },
  });
  if (res.status !== 201) throw new Error(`order: HTTP ${res.status}`);
}

/** A cart of one volume, the Discovery set twice and a builder set of the five best sellers. */
async function fillSetsCart(api: ApiClient) {
  await fillCart(api, [['symphony', 30]]);
  await api.cart.addDiscovery({ body: { qty: 2 } });
  const options = await api.sets.builder();
  if (options.status !== 200) throw new Error(`builder: HTTP ${options.status}`);
  const slugs = options.body.options.slice(0, 5).map((o) => o.slug);
  const res = await api.cart.addBuilder({ body: { slugs, qty: 1 } });
  if (res.status !== 200) throw new Error(`builder add: HTTP ${res.status}`);
}

/*
 * Sets at their worst (break-ui, #22): the five longest names and brands of the guide in the
 * Discovery set, a seven-digit set price (the builder costs the same), 99 of each set in the cart,
 * and a builder set whose five 10 ml bottles all ran out after it was added. `bestSets` puts back
 * the seed's set (the first five fragrances, 299 000, 10 boxes; `seedDiscoverySet`), whatever an
 * interrupted run left behind.
 */
const LONG_FIVE = [
  'baccarat-rouge-540',
  'blue-sapphire',
  'le-male-le-parfum',
  'pink-molecule-090-09',
  'montabaco-intensivo',
];
const LONG_FIVE_NAMES = [
  'Baccarat Rouge 540',
  'Blue Sapphire',
  'Le Male Le Parfum',
  'Pink Molécule 090.09',
  'Montabaco Intensivo',
];
const SOLD_FIVE = ['symphony', 'tygar', 'ink-mark', 'power-of-you', 'rain-tea'];
const tenMlOf = `ml = 10 and fragrance_id in (select id from fragrances where slug = any($1))`;
async function worstSets(db: ShotDb) {
  await db.query('update discovery_set set price = 1250000, on_hand = 120');
  await db.query('delete from discovery_set_items');
  await db.query(
    `insert into discovery_set_items (position, fragrance_id)
     select i, (select id from fragrances where slug = ($1::text[])[i])
     from generate_subscripts($1::text[], 1) as i`,
    [LONG_FIVE],
  );
  await db.query(`update volumes set on_hand = 120 where ${tenMlOf}`, [LONG_FIVE]);
}
async function bestSets(db: ShotDb) {
  await db.query('update discovery_set set price = 299000, on_hand = 10');
  await db.query('delete from discovery_set_items');
  await db.query(
    `insert into discovery_set_items (position, fragrance_id)
     select row_number() over (order by id), id from (select id from fragrances order by id limit 5) f`,
  );
  for (const slug of [...LONG_FIVE, ...SOLD_FIVE]) await db.restore(slug);
}
/** Taps the builder rows of these fragrances, then brings the set box back into view. */
async function pickByName(page: Page, names: string[]) {
  const picks = page.getByTestId('pick');
  await picks.first().waitFor();
  for (const name of names) await picks.filter({ hasText: name }).first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
}
/** A cart of the worst sets: 99 Discovery sets, 99 builder sets of the longest five, and a builder set gone. */
async function fillWorstSetsCart(api: ApiClient, db: ShotDb) {
  await fillCart(api, []);
  const discovery = await api.cart.addDiscovery({ body: { qty: 99 } });
  if (discovery.status !== 200) throw new Error(`discovery add: HTTP ${discovery.status}`);
  const long = await api.cart.addBuilder({ body: { slugs: LONG_FIVE, qty: 99 } });
  if (long.status !== 200) throw new Error(`builder add: HTTP ${long.status}`);
  const gone = await api.cart.addBuilder({ body: { slugs: SOLD_FIVE, qty: 1 } });
  if (gone.status !== 200) throw new Error(`builder add: HTTP ${gone.status}`);
  await db.query(`update volumes set on_hand = 0 where ${tenMlOf}`, [SOLD_FIVE]);
}
/** The name of the n-th builder row, and its slug, so a shot can take its 10 ml away. */
let builderVictim: string | undefined;
async function sellOutPicked(page: Page, db: ShotDb) {
  const name = await page.getByTestId('pick').first().locator('.type-name').innerText();
  const { rows } = await db.query('select slug from fragrances where name = $1', [name]);
  builderVictim = String(rows[0]?.slug);
  await db.setOnHand(builderVictim, 0);
}

/** Checkout's state for a shot: phone shared, Samarkand saved, the mockup's 243 000 cart. */
async function checkoutReady(api: ApiClient, db: ShotDb, consent: 'given' | 'none') {
  await sharePhone(api);
  await chooseCity(api);
  await clearOrders(db, { consent });
  await fillCart(api, [
    ['symphony', 10],
    ['tygar', 30],
  ]);
}
const checkoutDone = async ({ api, db }: { api: ApiClient; db: ShotDb }) => {
  await clearOrders(db);
  await emptyCart({ api, db });
};

/** Opens the point picker (on the saved city's points) and takes the first point. */
async function pickFirstPoint(page: Page) {
  await page.getByTestId('choose-point').click();
  await sheet(page).getByTestId('point-row').first().click();
  await sheet(page).waitFor({ state: 'detached' });
  await page.getByTestId('chosen-point').waitFor();
}

/** Opens the newest order from the «Заказы» list (a cancelled one shows its reason instead of the timeline). */
async function openFirstOrder(page: Page, shows: 'timeline' | 'cancelled' = 'timeline') {
  await page.getByTestId('order-row').first().click();
  await page.getByTestId(shows).waitFor();
}

/** An unpaid order of the mockup's two fragrances, ready to pay. */
async function unpaidOrder({ api, db }: { api: ApiClient; db: ShotDb }) {
  await sharePhone(api);
  await clearOrders(db, { consent: 'given' });
  await placeOrder(api, [
    ['symphony', 10],
    ['tygar', 30],
  ]);
}

/** From the newest order's page, «Перейти к оплате» (#28); waits for the part `shows`. */
async function openPayment(page: Page, shows = 'transfer') {
  await openFirstOrder(page);
  await page.getByTestId('go-to-pay').click();
  await page.getByTestId(shows).waitFor();
}

/**
 * A bank app's «transfer done» screen as a PNG, drawn on a canvas in the page (no image library
 * in the shots): what a shopper screenshots and uploads. Generic, no bank's name or logo.
 */
async function receiptPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 720;
    c.height = 1280;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#f4f5f7';
    g.fillRect(0, 0, 720, 1280);
    g.fillStyle = '#ffffff';
    g.fillRect(40, 140, 640, 900);
    g.fillStyle = '#2fa36b';
    g.beginPath();
    g.arc(360, 260, 56, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(332, 262);
    g.lineTo(352, 284);
    g.lineTo(390, 240);
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#1d1d1f';
    g.font = '600 34px sans-serif';
    g.fillText('Перевод выполнен', 360, 380);
    g.font = '700 56px sans-serif';
    g.fillText('243 000 UZS', 360, 470);
    g.textAlign = 'left';
    const rows = [
      ['Получатель', 'RAHIMOVA S.'],
      ['Карта', '9860 •••• •••• 7364'],
      ['Дата', '10.11.2026 14:32'],
      ['Комиссия', '0 UZS'],
      ['Номер операции', '58210447'],
    ];
    rows.forEach(([k, v], i) => {
      const y = 580 + i * 84;
      g.fillStyle = '#8a8a8e';
      g.font = '28px sans-serif';
      g.fillText(k as string, 80, y);
      g.fillStyle = '#1d1d1f';
      g.font = '600 28px sans-serif';
      g.textAlign = 'right';
      g.fillText(v as string, 640, y);
      g.textAlign = 'left';
    });
    const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b as Blob), 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  return Buffer.from(base64, 'base64');
}

/** Picks the receipt in the screen's file input, as the system picker would. */
async function chooseReceipt(page: Page) {
  await page.getByTestId('receipt-input').setInputFiles({
    name: 'Screenshot_20261110_143214.png',
    mimeType: 'image/png',
    buffer: await receiptPng(page),
  });
  await page.getByTestId('receipt-file').waitFor();
}

/**
 * The newest order, back to «Ожидает оплаты» after its receipt found no money (#36): a receipt
 * row decided `payment_not_found` two hours ago, as the wait window leaves it (or at once, as a
 * repeat of another order's receipt). The payment screen lists receipts, never opens their files.
 */
async function notFoundOrder(ctx: { api: ApiClient; db: ShotDb }, { repeat }: { repeat: boolean }) {
  await unpaidOrder(ctx);
  const { rows } = await ctx.db.query(
    `insert into receipts (order_id, source, verdict, kind, size, original_key, normalized_key,
       normalized_mime, width, height, sha256, phash, created_at)
     select o.id, 'miniapp', 'payment_not_found', 'png', 184320, 'shots/' || gen_random_uuid(),
       'shots/' || gen_random_uuid(), 'image/png', 720, 1280, repeat('a', 64), repeat('0', 16),
       now() - interval '2 hours'
     from orders o
     where o.customer_id = (select id from customers where telegram_id = $1)
     order by o.id desc limit 1
     returning id`,
    [SHOT_USER.id],
  );
  // a repeat receipt names the receipt it repeats; any receipt will do for the screen
  if (repeat)
    await ctx.db.query('update receipts set duplicate_of = id where id = $1', [rows[0]!.id]);
}

/** Without a card: the order was placed while there was one, then the owner took it off. */
const noCardDone = async (ctx: { api: ApiClient; db: ShotDb }) => {
  await ctx.db.shopCard(SHOT_CARD);
  await checkoutDone(ctx);
};

/**
 * A one-page receipt PDF built by hand (no PDF library in the shots), as a bank app exports it: a
 * white portrait page with a Sage square and dark bars. The API renders its first page for real.
 */
function receiptPdf(): Buffer {
  const [width, height] = [298, 420];
  const bars = Array.from({ length: 10 }, (_, i) => {
    const w = 90 + ((i * 47) % 140);
    return `0.13 0.13 0.13 rg 24 ${height - 60 - i * 32} ${w} 10 re f`;
  }).join('\n');
  const content = `1 1 1 rg 0 0 ${width} ${height} re f\n0.6 0.65 0.57 rg 120 340 58 58 re f\n${bars}`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Picks a PDF receipt in the screen's file input (the busy PDF renders answer `try_again`). */
async function choosePdf(page: Page, name = 'Chek_10.11.2026.pdf') {
  await page.getByTestId('receipt-input').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: receiptPdf(),
  });
  await page.getByTestId('receipt-file').waitFor();
}

/** Picks a file the screen or the API refuses, and waits for the reason under the upload zone. */
async function refuseReceipt(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  { send = false }: { send?: boolean } = {},
) {
  await page.getByTestId('receipt-input').setInputFiles(file);
  if (send) await page.getByTestId('pay-action').click();
  const refused = page.getByTestId('receipt-refused');
  await refused.waitFor();
  await refused.evaluate((el) => el.scrollIntoView({ block: 'center' }));
}
/** A phone photo just over the 10 MB setting (the screen refuses it before sending). */
const OVERSIZE_PHOTO = () => {
  const buffer = Buffer.alloc(10 * 1024 * 1024 + 300 * 1024);
  buffer.set([0xff, 0xd8, 0xff, 0xe0]);
  return { name: 'IMG_20261110_143214.jpg', mimeType: 'image/jpeg', buffer };
};
/** A PDF by its first bytes that no reader opens (the API refuses it as unreadable). */
const BROKEN_PDF = () => ({
  name: 'chek.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7\n% the download stopped halfway\n1 0 obj\n<< /Type /Cat'),
});

/*
 * The payment screen at its worst (break-ui, #28): a 30-character holder, a seven-digit Amount
 * due (9 999 000) at 360 px, a reserve that ends after midnight («12-noyabr, 00:20 gacha»), an
 * order number in the 10 000s, and a PDF receipt under the long name a bank app gives it. The UZ
 * runs carry the longest step, hint and refusal strings.
 */
const WORST_HOLDER = 'MUHAMMADSODIQXON ABDURAHMONOVA';
const WORST_RECEIPT_NAME =
  'Kvitansiya_perevod_s_karty_na_kartu_9860xxxxxxxx7364_10.11.2026_23-41-07.pdf';
async function worstPayment({ api, db }: { api: ApiClient; db: ShotDb }) {
  await sharePhone(api);
  await clearOrders(db, { consent: 'given' });
  await numberFrom(db, 10482);
  // free delivery from 250 000: the Amount due is the bottle's price
  await db.query(`update volumes set price = 9999000 where ${ELYSIUM} and ml = 50`);
  await placeOrder(api, [['elysium-pour-homme-parfum', 50]]);
  await db.query(
    `update orders set reserve_until = ((now() at time zone 'Asia/Tashkent')::date + 1 + time '00:20') at time zone 'Asia/Tashkent'
     where customer_id = (select id from customers where telegram_id = $1)`,
    [SHOT_USER.id],
  );
  await db.shopCard({ number: SHOT_CARD.number, holder: WORST_HOLDER });
}
const worstPaymentDone = async (ctx: { api: ApiClient; db: ShotDb }) => {
  await worstDone(ctx);
  await ctx.db.shopCard(SHOT_CARD);
};

/** The shot customer's newest order, cancelled by the shopper through the real API. */
async function cancelNewestOrder(api: ApiClient) {
  const list = await api.orders.list({ query: {} });
  const number = list.status === 200 ? list.body.orders[0]?.number : undefined;
  if (!number) throw new Error('no order to cancel');
  const res = await api.orders.cancel({
    params: { number },
    body: { expectedStatus: 'awaiting_payment' },
  });
  if (res.status !== 200) throw new Error(`cancel: HTTP ${res.status}`);
}

/**
 * Moves the shot customer's newest order as `transition()` would, straight in the database (the
 * staff and system callers have no route the shots can drive yet): its status and its history row.
 */
async function moveNewestOrder(
  db: ShotDb,
  move: {
    from: string;
    to: string;
    action: string;
    actor: 'staff' | 'system' | 'customer';
    reason?: string;
  },
) {
  await db.query(
    `with o as (
       update orders set status = $3::order_status, updated_at = now()
       where id = (select o.id from orders o join customers c on c.id = o.customer_id
                   where c.telegram_id = $1 order by o.number desc limit 1)
       returning id)
     insert into order_events (order_id, from_status, to_status, action, actor_type, reason)
     select id, $2::order_status, $3::order_status, $4::order_action, $5::actor_type, $6 from o`,
    [SHOT_USER.id, move.from, move.to, move.action, move.actor, move.reason ?? null],
  );
}

/** The newest order cancelled by the expiry sweep, as the worker would (it does not run here). */
const expireNewestOrder = (db: ShotDb) =>
  moveNewestOrder(db, {
    from: 'awaiting_payment',
    to: 'cancelled',
    action: 'cancel',
    actor: 'system',
    reason: 'reserve_expired',
  });

/*
 * The realistic worst case for checkout and orders (break-ui): a 60-character name (a full UZ
 * name with patronymic), a greeting at the 250-character limit (setting
 * `orders.giftMessageMaxLength`), an address typed by hand, twelve lines, a seven-digit total
 * and order numbers in the 10 000s.
 */
const LONG_NAME = 'Muhammadsodiqxon Abdurahmonov-Nematullayev Shavkatjon oʻgʻli';
const LONG_GREETING =
  'Madinaxon! Tugʻilgan kuningiz muborak boʻlsin. Bu ifor sizga Samarqanddagi iliq kuzgi oqshomlarini, choyxonadagi uzoq suhbatlarimizni va Registon ustidagi quyosh botishini eslatib tursin. Doim shunday nurli va baxtli boʻling. Sevuvchi opangiz Dilnoza';
const TYPED_ADDRESS =
  'Urgut tumani, Kattaqoʻrgʻon koʻchasi 14-uy, eski bozor roʻparasidagi «Nur» dorixonasi yonida';
const LONG_COMMENT =
  'Iltimos, yetkazishdan bir soat oldin qabul qiluvchiga qoʻngʻiroq qiling. Javob bermasa, menga yozing: +998 93 555 12 34. Sovgʻa ekanini aytmang, bu syurpriz!';
const TWELVE_LINES: [string, 10 | 30 | 50, number?][] = [
  ['elysium-pour-homme-parfum', 50],
  ['baccarat-rouge-540', 50],
  ['blue-sapphire', 30],
  ['le-male-le-parfum', 10],
  ['montabaco-intensivo', 10],
  ['pink-molecule-090-09', 30],
  ['stronger-with-you', 10],
  ['hibiscus-mahajad', 10],
  ['molecule-02', 50],
  ['miss-dior-blooming-bouquet', 30],
  ['very-sexy-sea', 10],
  ['symphony', 10, 3],
];
/** Roja Elysium at a seven-digit price (and back to the seed's placeholder prices). */
const ELYSIUM = `fragrance_id = (select id from fragrances where slug = 'elysium-pour-homme-parfum')`;
async function priceyElysium(db: ShotDb) {
  await db.query(
    `update volumes set price = case ml when 10 then 1250000 when 30 then 2450000 else 3490000 end where ${ELYSIUM}`,
  );
}
async function seedElysium(db: ShotDb) {
  await db.query(
    `update volumes set price = case ml when 10 then 69000 when 30 then 149000 else 219000 end where ${ELYSIUM}`,
  );
}
/** The next order number; `numberFromSeed` puts it back after the shot customers' orders are gone. */
async function numberFrom(db: ShotDb, next: number) {
  await db.query(`select setval('orders_number_seq', $1, false)`, [next]);
}
async function numberFromSeed(db: ShotDb) {
  await db.query(
    `select setval('orders_number_seq', greatest(1001, coalesce((select max(number) from orders), 0) + 1), false)`,
  );
}
const worstDone = async (ctx: { api: ApiClient; db: ShotDb }) => {
  await checkoutDone(ctx);
  await seedElysium(ctx.db);
  await numberFromSeed(ctx.db);
};

/** Answers (or, with no answer, holds) the order creation; every other request goes through. */
const onCreateOrder = (page: Page, answer: (route: Route) => Promise<void> | void) =>
  page.route(
    (url) => url.pathname.endsWith('/orders'),
    (route) => (route.request().method() === 'POST' ? answer(route) : route.continue()),
  );
/** Fails one API read (not the page of the same path), as a dropped connection does, and reloads into its error state. */
async function failRead(page: Page, path: RegExp) {
  await page.route(
    (url) => path.test(url.pathname),
    (route) => (route.request().resourceType() === 'fetch' ? route.abort() : route.continue()),
  );
  await page.reload();
  await page.getByRole('button', { name: /Повторить|Qayta urinish/ }).waitFor();
}
/** Holds one API read unanswered and reloads, so the screen stays on its loading shape. */
async function holdRead(page: Page, path: RegExp) {
  await page.route(
    (url) => path.test(url.pathname),
    (route) => (route.request().resourceType() === 'fetch' ? undefined : route.continue()),
  );
  await page.reload();
  await page.locator('[data-skeleton]').first().waitFor();
}

/** A 60-character name, a greeting at the 250 limit, and a seven-digit total. */
const checkoutWorst: Omit<ScreenDef, 'id'> = {
  path: '/checkout',
  fullPage: true,
  setup: async ({ api, db }) => {
    await sharePhone(api);
    await chooseCity(api);
    await clearOrders(db, { consent: 'given' });
    await priceyElysium(db);
    await fillCart(api, [
      ['elysium-pour-homme-parfum', 50, 2],
      ['baccarat-rouge-540', 50],
    ]);
  },
  act: async ({ page }) => {
    await pickFirstPoint(page);
    await page.getByRole('textbox', { name: /^(Имя|Ism)$/ }).fill(LONG_NAME);
    await page.getByTestId('gift-toggle').click();
    await page.getByTestId('gift').getByRole('textbox').fill(LONG_GREETING);
  },
  teardown: worstDone,
};
/**
 * «Заказы» at its worst: numbers in the 10 000s, the longest status, twelve lines, a seven-digit
 * total, and «Показать ещё» (three a page here).
 */
const ordersWorst: Omit<ScreenDef, 'id'> = {
  path: '/orders',
  fullPage: true,
  setup: async ({ api, db }) => {
    await sharePhone(api);
    await clearOrders(db, { consent: 'given' });
    await priceyElysium(db);
    await numberFrom(db, 10479);
    await placeOrder(api, [['symphony', 10]]);
    await placeOrder(api, [
      ['tygar', 30],
      ['ink-mark', 10],
    ]);
    await placeOrder(api, [['baccarat-rouge-540', 50]], { gift: true });
    await placeOrder(api, TWELVE_LINES);
    // the longest status there is («Chek tekshirilmoqda»), next to a five-digit number
    await db.query(`update orders set status = 'receipt_review' where number = 10481`);
  },
  act: async ({ page }) => {
    await page.route(
      (url) => url.pathname.endsWith('/orders'),
      (route) => {
        if (route.request().resourceType() !== 'fetch') return route.continue();
        const url = new URL(route.request().url());
        url.searchParams.set('limit', '3');
        return route.continue({ url: url.toString() });
      },
    );
    await page.reload();
    await page.getByTestId('orders-more').waitFor();
  },
  teardown: worstDone,
};

/** The seed has no hits and no new flags: pin three hits and flag six novelties for Home and the catalog. */
const HITS = ['symphony', 'aventus', 'tygar'];
const NEWS = [
  'althair',
  'power-of-you',
  'ink-mark',
  'rain-tea',
  'safran-secret',
  'baccarat-rouge-540',
];
async function flagHome(db: ShotDb) {
  await db.query(`update fragrances set is_hit = true where slug = any($1)`, [HITS]);
  await db.query(`update fragrances set is_new = true where slug = any($1)`, [NEWS]);
}
async function unflagHome(db: ShotDb) {
  await db.query(`update fragrances set is_hit = false, is_new = false`);
}
const withFlags: Pick<ScreenDef, 'setup' | 'teardown'> = {
  setup: ({ db }) => flagHome(db),
  teardown: ({ db }) => unflagHome(db),
};
const catalogSheet =
  (name: RegExp): NonNullable<ScreenDef['act']> =>
  async ({ page }) => {
    await page.getByRole('button', { name }).first().click();
    await sheet(page).waitFor();
    await sheet(page).getByTestId('option-row').first().waitFor();
  };

/** Holds every catalog list request open, so the first load stays on its skeletons. */
const holdCatalog = async ({ page }: { page: Page }) => {
  await page.route('**/catalog/fragrances?*', () => undefined);
  await page.reload();
  await page.locator('[data-skeleton]').first().waitFor();
};
/** Fails every catalog list request, as a dropped connection does. */
const failCatalog = async ({ page }: { page: Page }) => {
  await page.route('**/catalog/fragrances?*', (route) => route.abort());
  await page.reload();
  await page.getByRole('button', { name: /Повторить|Qayta urinish/ }).waitFor();
};

/**
 * The realistic worst case through the data (break-ui): the longest brands of the guide pinned to
 * the top («Maison Francis Kurkdjian», «Boadicea the Victorious»), the longest name with a
 * seven-digit price, and a hit sold out in every volume.
 */
const WORST_HITS = [
  'elysium-pour-homme-parfum',
  'baccarat-rouge-540',
  'blue-sapphire',
  'miss-dior-blooming-bouquet',
];
const worstData: Pick<ScreenDef, 'setup' | 'teardown'> = {
  setup: async ({ db }) => {
    await db.query(`update fragrances set is_hit = true where slug = any($1)`, [WORST_HITS]);
    await db.query(`update fragrances set is_new = true where slug = 'baccarat-rouge-540'`);
    await db.query(
      `update volumes set price = case ml when 10 then 1250000 when 30 then 2450000 else 3490000 end
       where fragrance_id = (select id from fragrances where slug = 'elysium-pour-homme-parfum')`,
    );
    await db.setOnHand('blue-sapphire', 0);
  },
  teardown: async ({ db }) => {
    await unflagHome(db);
    // The seed's placeholder prices (one set for every fragrance).
    await db.query(
      `update volumes set price = case ml when 10 then 69000 when 30 then 149000 else 219000 end
       where fragrance_id = (select id from fragrances where slug = 'elysium-pour-homme-parfum')`,
    );
    await db.restore('blue-sapphire');
  },
};

interface ShotBanner {
  titleRu: string;
  titleUz: string;
  subtitleRu: string;
  subtitleUz: string;
  priceLineRu: string;
  priceLineUz: string;
}
/** An active promo banner whose photo is a seeded bottle photo (the photo set already exists). */
async function promoBanner(db: ShotDb, b: ShotBanner) {
  await clearBanners(db);
  await db.query(
    `insert into promo_banners (image_hash, title_ru, title_uz, subtitle_ru, subtitle_uz, price_line_ru, price_line_uz, target, active)
     values ((select photo_hash from volumes where photo_hash is not null order by id limit 1), $1, $2, $3, $4, $5, $6, 'catalog', true)`,
    [b.titleRu, b.titleUz, b.subtitleRu, b.subtitleUz, b.priceLineRu, b.priceLineUz],
  );
}
const clearBanners = async (db: ShotDb) => void (await db.query(`delete from promo_banners`));
const sloganAtLimit = longSlogan();

/*
 * Purchase shortcuts (#25): the list «+», «Купить сейчас», «Повторить заказ», «Мои пункты BTS».
 */
/** Forgets the shot customers' saved recipient + point pairs. */
async function clearSaved(db: ShotDb) {
  await db.query(
    `delete from saved_points where customer_id in (select id from customers where telegram_id = $1)`,
    [SHOT_USER.id],
  );
}
/** The n-th offered point of Samarkand. */
async function nthPoint(api: ApiClient, n: number) {
  const { region } = await firstPoint(api);
  const points = await api.delivery.points({ query: { regionId: region.id, city: 'Самарканд' } });
  if (points.status !== 200 || !points.body[n]) throw new Error(`no point ${n} (run bts:import)`);
  return points.body[n];
}
/** A «Купить сейчас» order of one 10 ml to this point and recipient: it saves the pair, the cart stays. */
async function buyNowTo(api: ApiClient, pointIndex: number, recipientName: string, phone: string) {
  const point = await nthPoint(api, pointIndex);
  const item = 'volume:symphony:10';
  const checkout = await api.checkout.get({ query: { regionId: point.regionId, item } });
  if (checkout.status !== 200) throw new Error(`checkout: HTTP ${checkout.status}`);
  const res = await api.orders.create({
    body: {
      recipientName,
      recipientPhone: phone,
      delivery: { kind: 'point', pointId: point.id },
      consent: true,
      confirmedTotal: checkout.body.quote.total,
      confirmedDiscount: checkout.body.quote.discount,
      idempotencyKey: randomUUID(),
      item,
    },
  });
  if (res.status !== 201) throw new Error(`order: HTTP ${res.status}`);
}
/**
 * Three saved pairs, the newest at a point BTS hid since (so the default is the one before it):
 * Dilnoza at the first point, Ali at the second, then Dilnoza at the third, which is hidden.
 */
async function savedPairs(api: ApiClient, db: ShotDb) {
  await clearSaved(db);
  await buyNowTo(api, 0, 'Dilnoza Karimova', '+998901234567');
  await buyNowTo(api, 1, 'Alisher Valiyev Abdumalikovich', '+998937654321');
  await buyNowTo(api, 2, 'Dilnoza Karimova', '+998901234567');
  const hidden = await nthPoint(api, 2);
  await db.query('update bts_points set active = false where id = $1', [hidden.id]);
  hiddenPoint = hidden.id;
}
let hiddenPoint: number | undefined;
async function savedPairsDone(ctx: { api: ApiClient; db: ShotDb }) {
  if (hiddenPoint)
    await ctx.db.query('update bts_points set active = true where id = $1', [hiddenPoint]);
  hiddenPoint = undefined;
  await clearSaved(ctx.db);
  await checkoutDone(ctx);
}
/** Marks the shot customer's orders, newest first, with these statuses (only finished ones repeat). */
async function setStatuses(db: ShotDb, statuses: string[]) {
  const { rows } = await db.query(
    `select o.id from orders o join customers c on c.id = o.customer_id
     where c.telegram_id = $1 order by o.number desc`,
    [SHOT_USER.id],
  );
  for (const [i, status] of statuses.entries())
    if (rows[i])
      await db.query('update orders set status = $2 where id = $1', [rows[i]!.id, status]);
}
const REPEAT_FIVE = [
  'power-of-you',
  'rain-tea',
  'baccarat-rouge-540',
  'blue-sapphire',
  'le-male-le-parfum',
];
async function restoreRepeat(ctx: { api: ApiClient; db: ShotDb }) {
  await checkoutDone(ctx);
  for (const slug of REPEAT_FIVE) await ctx.db.restore(slug);
}
/** Opens the newest order and presses «Повторить заказ»; the result sheet rises. */
async function repeatNewest(page: Page) {
  await openFirstOrder(page);
  await page.getByTestId('repeat-order').click();
  await page.getByTestId('repeat-result').waitFor();
}
const shortcutScreens: ScreenDef[] = [
  // The list cards at 360 px: «+» on the photo, a seven-digit price at full size on its own line.
  { id: 'list-cards-360', path: '/dev/list', fullPage: true, width: 360 },
  {
    // Several volumes available: «+» asks which, on the cheapest
    id: 'list-add-sheet',
    path: '/catalog',
    act: async ({ page }) => {
      await page.getByTestId('list-add').first().click();
      await page.getByTestId('volume-sheet').waitFor();
    },
  },
  {
    // One volume available: «+» adds it at once; the note rises above the tab bar
    id: 'list-added',
    path: '/search?q=symphony&s=1',
    setup: async ({ db }) => {
      await db.query(
        `update volumes set on_hand = 0 where ml <> 30 and fragrance_id = (select id from fragrances where slug = 'symphony')`,
      );
    },
    act: async ({ page }) => {
      await page.getByTestId('list-add').first().click();
      await page.locator('[data-testid="shop-note"][data-open]').waitFor();
    },
    teardown: emptyCart,
  },
  { id: 'catalog-worst-360-plus', path: '/catalog', ...worstData, width: 360 },
  {
    // a markdown on the 50 ml: the line total in Sage Ink, as on an order
    id: 'checkout-buy-now',
    path: '/checkout?item=volume:symphony:50',
    fullPage: true,
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await clearSaved(db);
      await db.markdown('symphony', 50, 175_000, 5);
    },
    act: async ({ page }) => pickFirstPoint(page),
    teardown: checkoutDone,
  },
  {
    id: 'checkout-buy-now-set',
    path: '/checkout?item=discovery_set',
    fullPage: true,
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await clearSaved(db);
    },
    act: async ({ page }) => pickFirstPoint(page),
    teardown: checkoutDone,
  },
  {
    // Sold out while the shopper looked: «Купить сейчас» goes back, not to the cart
    id: 'checkout-buy-now-gone',
    path: '/checkout?item=volume:tygar:50',
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await db.query(
        `update volumes set on_hand = 0 where ml = 50 and fragrance_id = (select id from fragrances where slug = 'tygar')`,
      );
    },
    teardown: checkoutDone,
  },
  {
    // «Мои пункты BTS» first; checkout starts on the last used pair BTS still offers
    id: 'checkout-saved-points',
    path: '/checkout',
    fullPage: true,
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await savedPairs(api, db);
    },
    teardown: savedPairsDone,
  },
  {
    id: 'profile-saved-points',
    path: '/profile',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await savedPairs(api, db);
    },
    teardown: savedPairsDone,
  },
  {
    id: 'order-repeat-all',
    path: '/orders',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
      await setStatuses(db, ['delivered']);
    },
    act: async ({ page }) => repeatNewest(page),
    teardown: checkoutDone,
  },
  {
    // Every reason a line comes back short, as the server says it: stock (capped), the 99 ceiling,
    // gone, and a builder set one of whose 10 ml ran out
    id: 'order-repeat-some',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [], {
        fill: async (a) => {
          await fillCart(a, [
            ['symphony', 10, 3],
            ['tygar', 30, 2],
            ['ink-mark', 50],
          ]);
          const set = await a.cart.addBuilder({ body: { slugs: REPEAT_FIVE, qty: 1 } });
          if (set.status !== 200) throw new Error(`builder add: HTTP ${set.status}`);
        },
      });
      await setStatuses(db, ['delivered']);
      const vol = (slug: string, ml: number, onHand: number) =>
        db.query(
          `update volumes set on_hand = $3 where ml = $2 and fragrance_id = (select id from fragrances where slug = $1)`,
          [slug, ml, onHand],
        );
      await vol('symphony', 10, 1);
      await vol('tygar', 30, 200);
      await vol('ink-mark', 50, 0);
      await vol('rain-tea', 10, 0);
      // the cart already holds 98 of the 30 ml: one more fits
      await api.cart.addLine({ body: { slug: 'tygar', ml: 30, qty: 98 } });
    },
    act: async ({ page }) => repeatNewest(page),
    teardown: restoreRepeat,
  },
  {
    // «Заказы»: «Повторить заказ» under the delivered and the cancelled rows, not the unpaid one
    id: 'orders-list-repeat',
    path: '/orders',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [['symphony', 10]]);
      await placeOrder(api, [['tygar', 30]]);
      await placeOrder(api, [['ink-mark', 50]]);
      await setStatuses(db, ['awaiting_payment', 'delivered', 'cancelled']);
    },
    teardown: checkoutDone,
  },
  {
    // the order page of an unpaid order: no «Повторить заказ»
    id: 'order-no-repeat',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [['symphony', 10]]);
    },
    act: async ({ page }) => openFirstOrder(page),
    teardown: checkoutDone,
  },
  {
    // a builder set one of whose 10 ml ran out: the screen names it
    id: 'checkout-buy-now-gone-set',
    path: `/checkout?item=builder_set:${REPEAT_FIVE.join(',')}`,
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await db.setOnHand('rain-tea', 0);
    },
    teardown: restoreRepeat,
  },
];

/*
 * #25 design polish: the states the first round left out, and the worst cases (break-ui).
 */
/** Opens the list «+» sheet on the first card that asks which volume. */
async function openVolumeSheet(page: Page) {
  await page.getByTestId('list-add').first().click();
  await page.getByTestId('volume-sheet').waitFor();
}
/** Opens the point picker from «Сменить» and takes the point at `n` of the saved city. */
async function switchPoint(page: Page, n: number) {
  await page
    .getByTestId('chosen-point')
    .getByRole('button', { name: /^(Сменить|Oʻzgartirish)$/ })
    .click();
  await sheet(page).getByTestId('point-row').nth(n).click();
  await sheet(page).waitFor({ state: 'detached' });
  await page.getByTestId('chosen-point').waitFor();
}
/** Opens the remove sheet of the profile's n-th saved pair. */
async function askRemove(page: Page, n = 0) {
  await page.getByTestId('saved-point-remove').nth(n).click();
  await page.getByTestId('saved-point-remove-sheet').waitFor();
}
const polishScreens: ScreenDef[] = [
  // The list cards at the comp's width, beside the 360 px set.
  { id: 'list-cards', path: '/dev/list', fullPage: true },
  {
    id: 'list-add-sheet-360',
    path: '/catalog',
    width: 360,
    act: async ({ page }) => openVolumeSheet(page),
  },
  {
    // A markdown on the 30 ml and the 50 ml sold out: struck price, the sale row, a locked tile
    id: 'list-add-sheet-sale',
    path: '/search?q=rain%20tea&s=1',
    setup: async ({ db }) => {
      await db.markdown('rain-tea', 30, 119_000, 4);
      await db.query(
        `update volumes set on_hand = 0 where ml = 50 and fragrance_id = (select id from fragrances where slug = 'rain-tea')`,
      );
    },
    act: async ({ page }) => {
      await openVolumeSheet(page);
      await sheet(page).getByRole('radio', { name: /30/ }).click();
    },
    teardown: async ({ db }) => db.restore('rain-tea'),
  },
  {
    // The volume ran out while the sheet was up: it says so in the sheet, above the button
    id: 'list-add-sheet-error',
    path: '/catalog',
    act: async ({ page }) => {
      await openVolumeSheet(page);
      await page.route('**/cart/lines', (route) =>
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: '{"code":"sold_out"}',
        }),
      );
      await sheet(page)
        .getByRole('button', { name: /(В корзину|Savatga)/ })
        .click();
      await sheet(page).getByRole('alert').waitFor();
    },
  },
  {
    // One volume available on the catalog's first card: «+» adds it, the note rises over the tab bar
    id: 'list-added-catalog',
    path: '/catalog',
    setup: async ({ db }) => {
      await db.query(
        `update volumes set on_hand = 0 where ml <> 10 and fragrance_id = (select id from fragrances where slug = 'rain-tea')`,
      );
    },
    act: async ({ page }) => {
      await page.getByTestId('list-add').first().click();
      await page.locator('[data-testid="shop-note"][data-open]').waitFor();
    },
    teardown: async (ctx) => {
      await emptyCart(ctx);
      await ctx.db.restore('rain-tea');
    },
  },
  {
    // The cart holds a promo code: the buy-now note says it waits there and does not apply here
    id: 'checkout-buy-now-promo',
    path: '/checkout?item=volume:symphony:30',
    fullPage: true,
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await clearSaved(db);
      await shotPromo(db);
      const res = await api.cart.applyPromoCode({ body: { code: 'BLOGER10' } });
      if (res.status !== 200) throw new Error(`promo: HTTP ${res.status}`);
    },
    act: async ({ page }) => pickFirstPoint(page),
    teardown: async (ctx) => {
      await forgetPromo(ctx);
      await checkoutDone(ctx);
    },
  },
  {
    // «Купить сейчас» from the builder: the set with its five
    id: 'checkout-buy-now-builder',
    path: `/checkout?item=builder_set:${REPEAT_FIVE.join(',')}`,
    fullPage: true,
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await clearSaved(db);
    },
    act: async ({ page }) => pickFirstPoint(page),
    teardown: restoreRepeat,
  },
  {
    // Nothing of the order is in stock now: the calm none-title and the way to the catalog
    id: 'order-repeat-none',
    path: '/orders',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [['ink-mark', 50]]);
      await setStatuses(db, ['delivered']);
      await db.setOnHand('ink-mark', 0);
    },
    act: async ({ page }) => repeatNewest(page),
    teardown: async (ctx) => {
      await checkoutDone(ctx);
      await ctx.db.restore('ink-mark');
    },
  },
  {
    // Nothing saved yet: the section says what will appear there
    id: 'profile-saved-points-empty',
    path: '/profile',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearSaved(db);
    },
  },
  {
    // The bin asks first, naming the pair
    id: 'profile-saved-remove',
    path: '/profile',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await savedPairs(api, db);
    },
    act: async ({ page }) => askRemove(page, 0),
    teardown: savedPairsDone,
  },
  {
    // Checkout started on the saved pair, then the shopper chose another point: no pair is ticked
    id: 'checkout-saved-switch',
    path: '/checkout',
    fullPage: true,
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await savedPairs(api, db);
    },
    act: async ({ page }) => switchPoint(page, 5),
    teardown: savedPairsDone,
  },
];

/*
 * Worst cases for #25 (break-ui): a 60-character fragrance name with seven-digit prices at 360 px,
 * a repeat of twelve lines with every reason, five saved pairs with long UZ addresses and long
 * recipient names (one point hidden by BTS), and a buy-now with the longest promo code in the cart.
 */
const NAME_60 = 'Elysium Pour Homme Parfum Extraordinaire Cologne Royale Noir';
let elysiumName: string | undefined;
async function longElysium(db: ShotDb) {
  await worstData.setup!({ db } as { api: ApiClient; db: ShotDb });
  const { rows } = await db.query(
    `select name from fragrances where slug = 'elysium-pour-homme-parfum'`,
  );
  elysiumName ??= String(rows[0]!.name);
  await db.query(`update fragrances set name = $1 where slug = 'elysium-pour-homme-parfum'`, [
    NAME_60,
  ]);
}
async function shortElysium(ctx: { api: ApiClient; db: ShotDb }) {
  await worstData.teardown!(ctx);
  if (elysiumName)
    await ctx.db.query(`update fragrances set name = $1 where slug = 'elysium-pour-homme-parfum'`, [
      elysiumName,
    ]);
  await ctx.db.restore('elysium-pour-homme-parfum');
}
const LONG_RECIPIENTS = [
  LONG_NAME,
  'Gulchehraxon Rahmonberdiyeva-Toʻxtasinova Abdumalik qizi',
  'Alisher Valiyev Abdumalikovich',
  'Shahnozabegim Xudoyberdiyeva-Qoʻchqorova Ravshan qizi',
  'Oʻtkirbek Gʻayratjon oʻgʻli Nurmuhammedov-Saidaxmedov',
];
const LONG_ADDRESSES = [
  'Samarqand viloyati, Pastdargʻom tumani, Juma shahri, Amir Temur koʻchasi 112-uy, «Oʻzbekiston pochtasi» binosining ikkinchi qavati',
  'Samarqand shahri, Bogʻishamol mahallasi, Gʻijduvoniy koʻchasi 7A-uy, «Korzinka» supermarketi roʻparasidagi doʻkonlar qatori',
  'Samarqand shahri, Siyob bozori yonidagi Toshkent yoʻli 45-uy, birinchi qavat, kirish hovli tomondan',
  'Samarqand shahri, Universitet xiyoboni 15, Samarqand davlat universiteti talabalar turar joyi qarshisida',
  'Samarqand shahri, Mirzo Ulugʻbek koʻchasi 77-uy, «Afrosiyob» savdo markazi, yer osti qavati, 12-doʻkon',
];
let savedAddresses: { id: number; address: string }[] = [];
let hiddenWorst: number | undefined;
async function worstSaved(api: ApiClient, db: ShotDb) {
  await clearSaved(db);
  for (const [i, name] of LONG_RECIPIENTS.entries()) {
    const point = await nthPoint(api, i);
    const { rows } = await db.query('select address from bts_points where id = $1', [point.id]);
    savedAddresses.push({ id: point.id, address: String(rows[0]!.address) });
    await db.query('update bts_points set address = $2 where id = $1', [
      point.id,
      LONG_ADDRESSES[i],
    ]);
    await buyNowTo(api, i, name, `+99890${String(1234560 + i)}`);
  }
  hiddenWorst = (await nthPoint(api, 3)).id;
  await db.query('update bts_points set active = false where id = $1', [hiddenWorst]);
}
async function worstSavedDone(ctx: { api: ApiClient; db: ShotDb }) {
  if (hiddenWorst)
    await ctx.db.query('update bts_points set active = true where id = $1', [hiddenWorst]);
  hiddenWorst = undefined;
  for (const { id, address } of savedAddresses)
    await ctx.db.query('update bts_points set address = $2 where id = $1', [id, address]);
  savedAddresses = [];
  await clearSaved(ctx.db);
  await checkoutDone(ctx);
}
const worstShortcutScreens: ScreenDef[] = [
  {
    id: 'worst-25-list-360',
    path: '/catalog',
    width: 360,
    setup: ({ db }) => longElysium(db),
    teardown: shortElysium,
  },
  {
    // the 60-character name and seven-digit prices in the sheet, the 30 ml marked down
    id: 'worst-25-sheet-360',
    path: '/catalog',
    width: 360,
    setup: async ({ db }) => {
      await longElysium(db);
      await db.markdown('elysium-pour-homme-parfum', 30, 1_990_000, 3);
    },
    act: async ({ page }) => {
      await openVolumeSheet(page);
      await sheet(page).getByRole('radio', { name: /30/ }).click();
    },
    teardown: shortElysium,
  },
  {
    // twelve lines: gone, capped by stock, at the 99 ceiling (some and none), and the rest added
    id: 'worst-25-repeat-12',
    path: '/orders',
    setup: async ({ api, db }) => {
      await longElysium(db);
      await db.restore('blue-sapphire');
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, TWELVE_LINES);
      await setStatuses(db, ['delivered']);
      const vol = (slug: string, ml: number, onHand: number) =>
        db.query(
          `update volumes set on_hand = $3 where ml = $2 and fragrance_id = (select id from fragrances where slug = $1)`,
          [slug, ml, onHand],
        );
      await vol('elysium-pour-homme-parfum', 50, 0);
      await vol('blue-sapphire', 30, 0);
      await vol('hibiscus-mahajad', 10, 0);
      await vol('symphony', 10, 1);
      await vol('le-male-le-parfum', 10, 200);
      await vol('montabaco-intensivo', 10, 200);
      await api.cart.addLine({ body: { slug: 'le-male-le-parfum', ml: 10, qty: 99 } });
      await api.cart.addLine({ body: { slug: 'montabaco-intensivo', ml: 10, qty: 99 } });
    },
    act: async ({ page }) => repeatNewest(page),
    teardown: async (ctx) => {
      await checkoutDone(ctx);
      for (const [slug] of TWELVE_LINES) await ctx.db.restore(slug);
      await shortElysium(ctx);
    },
  },
  {
    id: 'worst-25-saved-profile',
    path: '/profile',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await worstSaved(api, db);
    },
    teardown: worstSavedDone,
  },
  {
    id: 'worst-25-saved-remove',
    path: '/profile',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await worstSaved(api, db);
    },
    act: async ({ page }) => askRemove(page, 0),
    teardown: worstSavedDone,
  },
  {
    id: 'worst-25-saved-checkout',
    path: '/checkout',
    fullPage: true,
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await worstSaved(api, db);
    },
    teardown: worstSavedDone,
  },
  {
    // the 60-character name at a seven-digit price, the longest promo code waiting in the cart
    id: 'worst-25-buy-now-360',
    path: '/checkout?item=volume:elysium-pour-homme-parfum:50',
    width: 360,
    fullPage: true,
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await clearSaved(db);
      await longElysium(db);
      await db.query(
        `insert into promo_codes (code, kind, percent) values ($1, 'percent', 10)
         on conflict (code) do update set active = true`,
        [SHOT_LONG_CODE],
      );
      const res = await api.cart.applyPromoCode({ body: { code: SHOT_LONG_CODE } });
      if (res.status !== 200) throw new Error(`promo: HTTP ${res.status}`);
    },
    act: async ({ page }) => pickFirstPoint(page),
    teardown: async (ctx) => {
      await forgetPromo(ctx);
      await ctx.db.query(`delete from promo_codes where code = $1`, [SHOT_LONG_CODE]);
      await checkoutDone(ctx);
      await shortElysium(ctx);
    },
  },
];

export const screens: ScreenDef[] = [
  {
    id: 'home',
    path: '/',
    setup: async ({ api, db }) => {
      await forgetCity(api);
      await flagHome(db);
    },
    teardown: ({ db }) => unflagHome(db),
  },
  // Home with the delivery city chosen, and the sheet that changes it.
  {
    id: 'home-delivery',
    path: '/',
    setup: async ({ api, db }) => {
      await chooseCity(api);
      await flagHome(db);
    },
    teardown: ({ db }) => unflagHome(db),
  },
  // The whole page: «Популярное» (no ХИТ badge: the title says it) and the «Новинки» rail.
  { id: 'home-full', path: '/', ...withFlags, fullPage: true },
  // A 360 px Android, the narrowest phone we build for.
  { id: 'home-360', path: '/', ...withFlags, width: 360, fullPage: true },
  { id: 'home-loading', path: '/', loading: true, act: holdCatalog },
  { id: 'home-error', path: '/', act: failCatalog },
  {
    // Nothing visible in the catalog yet: one calm state instead of empty sections.
    id: 'home-empty',
    path: '/',
    setup: async ({ db }) => void (await db.query(`update fragrances set hidden = true`)),
    teardown: async ({ db }) => void (await db.query(`update fragrances set hidden = false`)),
  },
  {
    // «Популярное» with a chip selected: it filters in place.
    id: 'home-popular-femme',
    path: '/',
    ...withFlags,
    act: async ({ page }) => {
      await page.getByRole('radio', { name: 'Femme' }).click();
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-skeleton]') &&
          !document.querySelector('[aria-busy="true"]'),
      );
    },
  },
  {
    id: 'delivery-regions',
    path: '/',
    setup: ({ api }) => forgetCity(api),
    act: async ({ page }) => {
      await openCitySheet(page);
      await sheet(page).getByTestId('region-row').first().waitFor();
    },
  },
  {
    id: 'delivery-cities',
    path: '/',
    setup: ({ api }) => forgetCity(api),
    act: async ({ page }) => {
      await openCitySheet(page);
      await pickRegion(page, 2); // Samarkand region
    },
  },
  {
    id: 'delivery-city-selected',
    path: '/',
    setup: ({ api }) => chooseCity(api),
    act: async ({ page }) => {
      await openCitySheet(page); // opens on the saved city's region
      await sheet(page).getByTestId('city-row').first().waitFor();
    },
  },
  // The point picker (checkout embeds it), hosted by the dev-only route.
  {
    id: 'delivery-point-regions',
    path: '/dev/delivery',
    act: async ({ page }) => void (await sheet(page).getByTestId('region-row').first().waitFor()),
  },
  {
    id: 'delivery-point-cities',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
    },
  },
  {
    id: 'delivery-points',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
    },
  },
  {
    id: 'delivery-point-search',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await sheet(page).getByRole('searchbox').fill('чилонзар');
      await sheet(page).getByTestId('point-row').first().waitFor();
    },
  },
  {
    id: 'delivery-point-typed',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
      await sheet(page)
        .locator('button.type-button, button')
        .filter({ hasText: /Нет вашего пункта|Punktingiz yoʻqmi/ })
        .click();
      await sheet(page).getByRole('textbox').waitFor();
    },
  },
  {
    id: 'delivery-point-noresults',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await sheet(page).getByRole('searchbox').fill('qwerty');
      await sheet(page)
        .getByRole('heading', { name: /Ничего не нашли|Hech narsa topilmadi/ })
        .waitFor();
    },
  },
  {
    // the end of a city's list: the way into the typed address
    id: 'delivery-points-end',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
      await sheet(page).evaluate((dialog) => {
        const body = [...dialog.querySelectorAll('div')].find(
          (d) => getComputedStyle(d).overflowY === 'auto',
        );
        if (body) body.scrollTop = body.scrollHeight;
      });
    },
  },
  {
    // reopened on a saved point: the picker opens on its city, the row marked and in view
    id: 'delivery-point-selected',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
      await sheet(page).getByTestId('point-row').nth(6).click();
      await sheet(page).waitFor({ state: 'detached' });
      await page.getByRole('button', { name: /Сменить|Oʻzgartirish/ }).click();
      await sheet(page).locator('[data-testid="point-row"][aria-pressed="true"]').waitFor();
    },
  },
  {
    // checkout's collapsed choice (#23 embeds it): name, address · hours, «Сменить», the city count
    id: 'delivery-point-card',
    path: '/dev/delivery',
    act: async ({ page }) => {
      await pickRegion(page, 2);
      await pickCityRow(page, 'Самарканд');
      await sheet(page).getByTestId('point-row').nth(6).click();
      await sheet(page).waitFor({ state: 'detached' });
      await page
        .getByTestId('chosen-point')
        .getByText(/ещё|yana/)
        .waitFor();
    },
  },
  // Catalog (#15): the default, each filter sheet, the sort, a combination, and the states.
  { id: 'catalog', path: '/catalog', fullPage: true },
  { id: 'catalog-sheet-family', path: '/catalog', act: catalogSheet(/Семейство|Oila/) },
  { id: 'catalog-sheet-volume', path: '/catalog', act: catalogSheet(/Объём|Hajm/) },
  { id: 'catalog-sheet-season', path: '/catalog', act: catalogSheet(/Сезон|Mavsum/) },
  {
    id: 'catalog-sheet-price',
    path: '/catalog',
    act: async ({ page }) => {
      await page
        .getByRole('button', { name: /Цена|Narx/ })
        .first()
        .click();
      await sheet(page).getByRole('textbox').first().waitFor();
    },
  },
  {
    id: 'catalog-sheet-sort',
    path: '/catalog',
    act: async ({ page }) => {
      await page.getByRole('button', { name: /Топ продаж|Koʻp sotilganlar/ }).click();
      await sheet(page).getByTestId('option-row').first().waitFor();
    },
  },
  { id: 'catalog-sort-price-asc', path: '/catalog?sort=price_asc', fullPage: true },
  { id: 'catalog-sort-new', path: '/catalog?sort=new', ...withFlags, fullPage: true },
  {
    id: 'catalog-filtered',
    path: '/catalog?type=femme&volume=30&season=autumn_winter&min=100000&max=200000',
    fullPage: true,
  },
  { id: 'catalog-nothing-found', path: '/catalog?min=9000000' },
  {
    // The longest family name of the guide, chosen: the chip shows it.
    id: 'catalog-family-chosen',
    path: '/catalog',
    act: async ({ page, db }) => {
      await catalogSheet(/Семейство|Oila/)({ page, db });
      await sheet(page)
        .getByTestId('option-row')
        .filter({ hasText: /Древесно-цветочный мускусный|Yogʻochli gulli mushkli/ })
        .click();
      await sheet(page).waitFor({ state: 'detached' });
      await page
        .getByRole('button', { name: /Древесно-цветочный мускусный|Yogʻochli gulli mushkli/ })
        .waitFor();
    },
  },
  {
    // «Показать ещё»: the second page settles in under the first.
    id: 'catalog-more',
    path: '/catalog',
    act: async ({ page }) => {
      const cards = page.getByRole('list', { name: /^(Каталог|Katalog)$/ }).getByRole('listitem');
      await page.getByRole('button', { name: /Показать ещё|Yana koʻrsatish/ }).click();
      await cards.nth(24).waitFor();
      await cards.nth(22).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  { id: 'catalog-360', path: '/catalog', width: 360 },
  { id: 'catalog-worst-360', path: '/catalog', ...worstData, width: 360, fullPage: true },
  { id: 'catalog-sets', path: '/catalog?type=sets' },
  {
    // One fragrance sold out in every volume: its card says «Нет в наличии» in place of the price.
    id: 'catalog-sold-out',
    path: '/catalog',
    setup: async ({ db }) => db.setOnHand('symphony', 0),
    teardown: async ({ db }) => db.restore('symphony'),
    ...{ fullPage: true },
  },
  // A filter change keeps the old list (dimmed); the skeleton is the first load.
  { id: 'catalog-loading', path: '/catalog', loading: true, act: holdCatalog },
  { id: 'catalog-error', path: '/catalog?type=homme', act: failCatalog },
  { id: 'cart', path: '/cart' },
  // Checkout (#23): the mockup's cart (243 000 with delivery to Samarkand), a point chosen.
  {
    id: 'checkout',
    path: '/checkout',
    fullPage: true,
    setup: ({ api, db }) => checkoutReady(api, db, 'given'),
    act: async ({ page }) => pickFirstPoint(page),
    teardown: checkoutDone,
  },
  {
    // the Telegram phone is not from an allowed country: the Recipient phone starts empty, with the hint
    id: 'checkout-foreign-phone',
    path: '/checkout',
    user: FOREIGN_PHONE_USER,
    setup: async ({ api, db }) => {
      await sharePhone(api, FOREIGN_PHONE_USER.id, '+79161234567');
      await chooseCity(api);
      await clearOrders(db, { consent: 'given' });
      await fillCart(api, [['symphony', 10]]);
    },
    act: async ({ page }) => pickFirstPoint(page),
    teardown: async ({ api, db }) => {
      await clearOrders(db);
      await fillCart(api, []);
    },
  },
  {
    // «Перейти к оплате» on a first order with the name cleared, half a phone and no point:
    // every field says what it needs
    id: 'checkout-errors',
    path: '/checkout',
    fullPage: true,
    setup: ({ api, db }) => checkoutReady(api, db, 'none'),
    act: async ({ page }) => {
      await page.getByRole('textbox', { name: /^(Имя|Ism)$/ }).fill('');
      await page.getByRole('textbox', { name: /Телефон получателя|telefoni/ }).fill('+998 90 12');
      await page.getByTestId('submit').click();
      await page.getByTestId('consent').getByRole('alert').waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    teardown: checkoutDone,
  },
  {
    // the first order: the consent check
    id: 'checkout-consent',
    path: '/checkout',
    fullPage: true,
    setup: ({ api, db }) => checkoutReady(api, db, 'none'),
    act: async ({ page }) => pickFirstPoint(page),
    teardown: checkoutDone,
  },
  {
    // «Это подарок» on, with a greeting for the card (free of charge: the total does not move)
    id: 'checkout-gift',
    path: '/checkout',
    fullPage: true,
    setup: ({ api, db }) => checkoutReady(api, db, 'given'),
    act: async ({ page }) => {
      await pickFirstPoint(page);
      await page.getByTestId('gift-toggle').click();
      await page
        .getByTestId('gift')
        .getByRole('textbox')
        .fill('С днём рождения, Мадина! Пусть этот аромат напоминает о нашем лете в Самарканде.');
    },
    teardown: checkoutDone,
  },
  {
    // the owner raised a price while the shopper was on the screen: the 409 sheet with the new total
    id: 'checkout-total-changed',
    path: '/checkout',
    setup: ({ api, db }) => checkoutReady(api, db, 'given'),
    act: async ({ page, db }) => {
      await pickFirstPoint(page);
      await db.query(
        `update volumes set price = price + 10000 where ml = 10 and fragrance_id = (select id from fragrances where slug = 'symphony')`,
      );
      await page.getByTestId('submit').click();
      await page.getByTestId('total-changed').waitFor();
    },
    teardown: async (ctx) => {
      await ctx.db.query(
        `update volumes set price = price - 10000 where ml = 10 and fragrance_id = (select id from fragrances where slug = 'symphony')`,
      );
      await checkoutDone(ctx);
    },
  },
  {
    // #29: the code stopped working while the shopper was on the screen, and free delivery offsets
    // it (260 000 − 25 000 + 25 000 = 260 000 shipped free): the same total, a different order, so
    // the sheet says the discount changed and names the code and why
    id: 'checkout-promo-lost',
    path: '/checkout',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await chooseCity(api);
      await clearOrders(db, { consent: 'given' });
      await db.query(
        `update volumes set price = price + 41000 where ml = 50 and fragrance_id = (select id from fragrances where slug = 'symphony')`,
      );
      await db.query(
        `insert into promo_codes (code, kind, amount) values ('MINUS25', 'fixed', 25000)
         on conflict (code) do update set kind = 'fixed', amount = 25000, percent = null,
           max_discount = null, expires_at = null, min_order_total = null, total_limit = null,
           per_customer_limit = null, new_customers_only = false, applies_to_marked_down = false,
           active = true`,
      );
      await forgetPromo({ api, db });
      await fillCart(api, [['symphony', 50]]);
      const res = await api.cart.applyPromoCode({ body: { code: 'MINUS25' } });
      if (res.status !== 200) throw new Error(`apply: HTTP ${res.status}`);
    },
    act: async ({ page, db }) => {
      await pickFirstPoint(page);
      await db.query(`update promo_codes set active = false where code = 'MINUS25'`);
      await page.getByTestId('submit').click();
      await page.getByTestId('total-changed').waitFor();
    },
    teardown: async (ctx) => {
      await ctx.db.query(
        `update volumes set price = price - 41000 where ml = 50 and fragrance_id = (select id from fragrances where slug = 'symphony')`,
      );
      await ctx.db.query(`update promo_codes set active = true where code = 'MINUS25'`);
      await forgetPromo(ctx);
      await checkoutDone(ctx);
    },
  },
  {
    // #29: the code stopped working while the shopper was on the screen and the total grew
    // (268 200 → 298 000): the sheet strikes the old total and names the code and why
    id: 'checkout-promo-changed',
    path: '/checkout',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await chooseCity(api);
      await clearOrders(db, { consent: 'given' });
      await shotPromo(db);
      await forgetPromo({ api, db });
      await fillCart(api, [
        ['symphony', 30],
        ['tygar', 30],
      ]);
      const res = await api.cart.applyPromoCode({ body: { code: 'BLOGER10' } });
      if (res.status !== 200) throw new Error(`apply: HTTP ${res.status}`);
    },
    act: async ({ page, db }) => {
      await pickFirstPoint(page);
      await db.query(`update promo_codes set active = false where code = 'BLOGER10'`);
      await page.getByTestId('submit').click();
      await page.getByTestId('total-changed').waitFor();
    },
    teardown: async (ctx) => {
      await ctx.db.query(`update promo_codes set active = true where code = 'BLOGER10'`);
      await forgetPromo(ctx);
      await checkoutDone(ctx);
    },
  },
  {
    // break-ui (#29): a 32-character code with a seven-digit fixed discount (7 × 219 000 −
    // 1 250 000 = 283 000) is switched off at checkout: the sheet names it over 1 533 000
    id: 'checkout-promo-changed-worst',
    path: '/checkout',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await chooseCity(api);
      await clearOrders(db, { consent: 'given' });
      await db.query(
        `insert into promo_codes (code, kind, amount) values ($1, 'fixed', 1250000)
         on conflict (code) do update set kind = 'fixed', amount = 1250000, percent = null,
           max_discount = null, expires_at = null, min_order_total = null, total_limit = null,
           per_customer_limit = null, new_customers_only = false, applies_to_marked_down = false,
           active = true`,
        [SHOT_LONG_CODE],
      );
      await forgetPromo({ api, db });
      await fillCart(api, [['symphony', 50, 7]]);
      const res = await api.cart.applyPromoCode({ body: { code: SHOT_LONG_CODE } });
      if (res.status !== 200) throw new Error(`apply: HTTP ${res.status}`);
    },
    act: async ({ page, db }) => {
      await pickFirstPoint(page);
      await db.query(`update promo_codes set active = false where code = $1`, [SHOT_LONG_CODE]);
      await page.getByTestId('submit').click();
      await page.getByTestId('total-changed').waitFor();
    },
    teardown: async (ctx) => {
      await forgetPromo(ctx);
      await checkoutDone(ctx);
      await ctx.db.query(`delete from promo_codes where code = $1`, [SHOT_LONG_CODE]);
    },
  },
  {
    // no account phone yet: checkout opens the registration step on arrival
    id: 'checkout-no-phone',
    path: '/checkout',
    user: NO_PHONE_USER,
    setup: ({ api }) => fillCart(api, [['symphony', 10]]),
    act: async ({ page }) => void (await sheet(page).waitFor()),
    teardown: async ({ api }) => fillCart(api, []),
  },
  // The «Заказы» tab: empty, then two orders (a gift among them), and an order's detail.
  { id: 'orders-empty', path: '/orders', setup: ({ db }) => clearOrders(db) },
  {
    id: 'orders-list',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
      await placeOrder(api, [['baccarat-rouge-540', 50]], { gift: true });
    },
    teardown: checkoutDone,
  },
  {
    id: 'order-detail',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
    },
    act: async ({ page }) => openFirstOrder(page),
    teardown: checkoutDone,
  },
  {
    id: 'order-detail-gift',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [['baccarat-rouge-540', 50]], {
        gift: true,
        giftMessage: 'С днём рождения, Мадина! Пусть этот аромат напоминает о нашем лете.',
        comment: 'Позвоните получателю за час до доставки',
      });
    },
    act: async ({ page }) => openFirstOrder(page),
    teardown: checkoutDone,
  },
  {
    // #37: handed to BTS from the orders group, with the tracking number under its step
    id: 'order-detail-tracking',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
      await moveNewestOrder(db, {
        from: 'awaiting_payment',
        to: 'handed_to_bts',
        action: 'hand_to_bts',
        actor: 'staff',
      });
      await db.query(
        `update orders set tracking_number = 'BTS 4471 0098 5521'
         where id = (select o.id from orders o join customers c on c.id = o.customer_id
                     where c.telegram_id = $1 order by o.number desc limit 1)`,
        [SHOT_USER.id],
      );
    },
    act: async ({ page }) => {
      await openFirstOrder(page);
      await page.getByTestId('tracking-number').waitFor();
    },
    teardown: checkoutDone,
  },
  // #24: «Отменить заказ» while unpaid, its confirmation, and a cancelled order (detail and list).
  {
    id: 'order-cancel',
    path: '/orders',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
    },
    act: async ({ page }) => {
      await openFirstOrder(page);
      await page.getByTestId('cancel-order').click();
      await sheet(page).getByTestId('cancel-sheet').waitFor();
    },
    teardown: checkoutDone,
  },
  {
    id: 'order-cancelled',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
      await expireNewestOrder(db);
    },
    act: async ({ page }) => openFirstOrder(page, 'cancelled'),
    teardown: checkoutDone,
  },
  {
    // a paid order the shop could not fulfil: the reason, and the manager will be in touch
    id: 'order-cancelled-paid',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [['baccarat-rouge-540', 50]]);
      await moveNewestOrder(db, {
        from: 'awaiting_payment',
        to: 'payment_confirmed',
        action: 'confirm_payment',
        actor: 'system',
      });
      await moveNewestOrder(db, {
        from: 'payment_confirmed',
        to: 'cancelled',
        action: 'cancel',
        actor: 'staff',
        reason: 'out_of_stock',
      });
    },
    act: async ({ page }) => openFirstOrder(page, 'cancelled'),
    teardown: checkoutDone,
  },
  {
    // the receipt went in while the sheet was open: the press answers 409 and says so
    id: 'order-cancel-changed',
    path: '/orders',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
    },
    act: async ({ page, db }) => {
      await openFirstOrder(page);
      await page.getByTestId('cancel-order').click();
      await sheet(page).getByTestId('cancel-sheet').waitFor();
      await moveNewestOrder(db, {
        from: 'awaiting_payment',
        to: 'receipt_review',
        action: 'submit_receipt',
        actor: 'customer',
      });
      await sheet(page)
        .getByRole('button', { name: /^(Отменить заказ|Buyurtmani bekor qilish)$/ })
        .click();
      await sheet(page).getByTestId('cancel-changed').waitFor();
    },
    teardown: checkoutDone,
  },
  {
    id: 'orders-cancelled',
    path: '/orders',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [['baccarat-rouge-540', 50]], { gift: true });
      await cancelNewestOrder(api);
      await placeOrder(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
    },
    teardown: checkoutDone,
  },
  // #28: the payment screen, a receipt chosen, on its way, refused, under review, and no card.
  {
    id: 'payment',
    path: '/orders',
    fullPage: true,
    setup: unpaidOrder,
    act: async ({ page }) => openPayment(page),
    teardown: checkoutDone,
  },
  {
    id: 'payment-copied',
    path: '/orders',
    setup: unpaidOrder,
    act: async ({ page }) => {
      await openPayment(page);
      await page.getByTestId('copy-card').click();
      await page.getByRole('status').getByText(/./).waitFor();
    },
    teardown: checkoutDone,
  },
  {
    id: 'payment-chosen',
    path: '/orders',
    setup: unpaidOrder,
    act: async ({ page }) => {
      await openPayment(page);
      await chooseReceipt(page);
      await page
        .getByTestId('receipt-file')
        .evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
    teardown: checkoutDone,
  },
  {
    id: 'payment-uploading',
    path: '/orders',
    setup: unpaidOrder,
    act: async ({ page }) => {
      await openPayment(page);
      await chooseReceipt(page);
      // the upload reports 46% and never finishes, so the progress holds still for the capture
      await page.evaluate(() => {
        XMLHttpRequest.prototype.send = function (this: XMLHttpRequest) {
          const { upload } = this;
          const progress = new ProgressEvent('progress', {
            lengthComputable: true,
            loaded: 46,
            total: 100,
          });
          setTimeout(() => upload.dispatchEvent(progress), 30);
        };
      });
      await page.getByTestId('pay-action').click();
      await page.getByTestId('upload-progress').getByText(/46/).waitFor();
      await page
        .getByTestId('receipt-file')
        .evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
    teardown: checkoutDone,
  },
  {
    // an iPhone's HEIC photo: the app names the formats it takes
    id: 'payment-refused',
    path: '/orders',
    setup: unpaidOrder,
    act: async ({ page }) => {
      await openPayment(page);
      await page.getByTestId('receipt-input').setInputFiles({
        name: 'IMG_2041.HEIC',
        mimeType: 'image/heic',
        buffer: Buffer.from('\0\0\0\x18ftypheic\0\0\0\0mif1heic'),
      });
      const refused = page.getByTestId('receipt-refused');
      await refused.waitFor();
      await refused.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
    teardown: checkoutDone,
  },
  {
    // a real upload through the API: the order moves to «Чек на проверке» and the screen with it
    id: 'payment-review',
    path: '/orders',
    fullPage: true,
    setup: unpaidOrder,
    act: async ({ page }) => {
      await openPayment(page);
      await chooseReceipt(page);
      await page.getByTestId('pay-action').click();
      await page.getByTestId('under-review').waitFor();
    },
    teardown: checkoutDone,
  },
  {
    id: 'payment-no-card',
    path: '/orders',
    fullPage: true,
    setup: async (ctx) => {
      await unpaidOrder(ctx);
      await ctx.db.shopCard(null);
    },
    // the note where the card was; a shopper who already paid still sends the receipt
    act: async ({ page }) => openPayment(page, 'no-card'),
    teardown: noCardDone,
  },
  // #36: back to «Ожидает оплаты» after «оплата не найдена», or a receipt that repeated another order's
  {
    id: 'payment-not-found',
    path: '/orders',
    fullPage: true,
    setup: (ctx) => notFoundOrder(ctx, { repeat: false }),
    act: async ({ page }) => openPayment(page, 'last-receipt-note'),
    teardown: checkoutDone,
  },
  {
    id: 'payment-repeat',
    path: '/orders',
    setup: (ctx) => notFoundOrder(ctx, { repeat: true }),
    act: async ({ page }) => openPayment(page, 'last-receipt-note'),
    teardown: checkoutDone,
  },
  {
    // every PDF render slot busy: the API answers 503 try_again, the chosen file stays
    id: 'payment-try-again',
    path: '/orders',
    setup: unpaidOrder,
    act: async ({ page }) => {
      await openPayment(page);
      await choosePdf(page);
      await page.route(/\/orders\/\d+\/receipts$/, (route) =>
        route.fulfill({ status: 503, json: { code: 'try_again' } }),
      );
      await page.getByTestId('pay-action').click();
      const alert = page.getByTestId('receipt-file').locator('xpath=..').getByRole('alert');
      await alert.waitFor();
      await alert.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
    teardown: checkoutDone,
  },
  // the default screen on a 360 px Android
  {
    id: 'payment-360',
    path: '/orders',
    width: 360,
    fullPage: true,
    setup: unpaidOrder,
    act: async ({ page }) => openPayment(page),
    teardown: checkoutDone,
  },
  {
    // over the size setting: refused on the phone, before anything is sent
    id: 'payment-refused-size',
    path: '/orders',
    setup: unpaidOrder,
    act: async ({ page }) => {
      await openPayment(page);
      await refuseReceipt(page, OVERSIZE_PHOTO());
    },
    teardown: checkoutDone,
  },
  {
    // a PDF by its first bytes that cannot be opened: the API says so
    id: 'payment-refused-unreadable',
    path: '/orders',
    setup: unpaidOrder,
    act: async ({ page }) => {
      await openPayment(page);
      await refuseReceipt(page, BROKEN_PDF(), { send: true });
    },
    teardown: checkoutDone,
  },
  // break-ui (#28): the worst payment enters through the API and the database, as real data does.
  {
    // the 30-character holder, 9 999 000 and «00:20» tomorrow at 360 px, a long-named PDF chosen
    id: 'payment-worst-360',
    path: '/orders',
    width: 360,
    fullPage: true,
    setup: worstPayment,
    act: async ({ page }) => {
      await openPayment(page);
      await choosePdf(page, WORST_RECEIPT_NAME);
    },
    teardown: worstPaymentDone,
  },
  {
    // the PDF goes to the API for real: «Чек на проверке» with the long name and the PDF mark
    id: 'payment-worst-review-360',
    path: '/orders',
    width: 360,
    fullPage: true,
    setup: worstPayment,
    act: async ({ page }) => {
      await openPayment(page);
      await choosePdf(page, WORST_RECEIPT_NAME);
      await page.getByTestId('pay-action').click();
      await page.getByTestId('under-review').waitFor();
    },
    teardown: worstPaymentDone,
  },
  {
    // every PDF render slot busy, with the long name and the longest UZ message
    id: 'payment-worst-try-again-360',
    path: '/orders',
    width: 360,
    setup: worstPayment,
    act: async ({ page }) => {
      await openPayment(page);
      await choosePdf(page, WORST_RECEIPT_NAME);
      await page.route(/\/orders\/\d+\/receipts$/, (route) =>
        route.fulfill({ status: 503, json: { code: 'try_again' } }),
      );
      await page.getByTestId('pay-action').click();
      const alert = page.getByTestId('receipt-file').locator('xpath=..').getByRole('alert');
      await alert.waitFor();
      await alert.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    },
    teardown: worstPaymentDone,
  },
  {
    // no card at 360 px: the note, the upload kept, and the size refusal stacked under it
    id: 'payment-worst-no-card-360',
    path: '/orders',
    width: 360,
    fullPage: true,
    setup: async (ctx) => {
      await worstPayment(ctx);
      await ctx.db.shopCard(null);
    },
    act: async ({ page }) => {
      await openPayment(page, 'no-card');
      await refuseReceipt(page, OVERSIZE_PHOTO());
    },
    teardown: worstPaymentDone,
  },
  {
    id: 'checkout-no-card',
    path: '/checkout',
    setup: async ({ api, db }) => {
      await checkoutReady(api, db, 'given');
      await db.shopCard(null);
    },
    teardown: noCardDone,
  },
  // Sets (#22) through checkout: the cart with set lines, then the order as bought.
  {
    id: 'checkout-sets',
    path: '/checkout',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await chooseCity(api);
      await clearOrders(db, { consent: 'given' });
      await fillSetsCart(api);
    },
    act: async ({ page }) => pickFirstPoint(page),
    teardown: checkoutDone,
  },
  {
    id: 'order-detail-sets',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [], { fill: fillSetsCart });
    },
    act: async ({ page }) => openFirstOrder(page),
    teardown: async (ctx) => {
      await ctx.db.query('update discovery_set set on_hand = 10');
      await checkoutDone(ctx);
    },
  },
  // break-ui (#23): the worst case enters through the API, as real data does.
  { id: 'checkout-worst', ...checkoutWorst },
  // the narrowest phone: the seven-digit total still shares the confirm button with its label
  { id: 'checkout-worst-360', ...checkoutWorst, width: 360 },
  {
    // no point fits: the address typed by hand, flagged for the manager
    id: 'checkout-typed',
    path: '/checkout',
    setup: ({ api, db }) => checkoutReady(api, db, 'given'),
    act: async ({ page }) => {
      await page.getByTestId('choose-point').click();
      await sheet(page)
        .getByRole('button', { name: /Укажите адрес вручную|Manzilni qoʻlda yozing/ })
        .click();
      await sheet(page).locator('#typed-address').fill(TYPED_ADDRESS);
      await sheet(page)
        .getByRole('button', { name: /^(Готово|Tayyor)$/ })
        .click();
      await sheet(page).waitFor({ state: 'detached' });
      await page.getByTestId('typed-point').scrollIntoViewIfNeeded();
    },
    teardown: checkoutDone,
  },
  {
    // «Перейти к оплате» pressed: the button keeps its width and spins while the order is made
    id: 'checkout-submitting',
    path: '/checkout',
    setup: ({ api, db }) => checkoutReady(api, db, 'given'),
    act: async ({ page }) => {
      await pickFirstPoint(page);
      await onCreateOrder(page, () => undefined);
      await page.getByTestId('submit').click();
      await page.locator('[data-testid="submit"][aria-busy="true"]').waitFor();
    },
    teardown: checkoutDone,
  },
  {
    // the transaction lost a race twice: 409 try_again asks for one more press
    id: 'checkout-try-again',
    path: '/checkout',
    setup: ({ api, db }) => checkoutReady(api, db, 'given'),
    act: async ({ page }) => {
      await pickFirstPoint(page);
      await onCreateOrder(page, (route) =>
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'try_again' }),
        }),
      );
      await page.getByTestId('submit').click();
      await page.getByRole('alert').waitFor();
    },
    teardown: checkoutDone,
  },
  {
    // everything sold out meanwhile: 409 nothing_to_order, the state says so and leads to the cart
    id: 'checkout-gone',
    path: '/checkout',
    setup: ({ api, db }) => checkoutReady(api, db, 'given'),
    act: async ({ page, db }) => {
      await pickFirstPoint(page);
      await db.setOnHand('symphony', 0);
      await db.setOnHand('tygar', 0);
      await page.getByTestId('submit').click();
      await page.getByRole('heading', { name: /Товаров больше нет|qolmadi/ }).waitFor();
    },
    teardown: async (ctx) => {
      await ctx.db.restore('symphony');
      await ctx.db.restore('tygar');
      await checkoutDone(ctx);
    },
  },
  {
    id: 'checkout-loading',
    path: '/checkout',
    loading: true,
    setup: ({ api, db }) => checkoutReady(api, db, 'given'),
    act: ({ page }) => holdRead(page, /\/checkout$/),
    teardown: checkoutDone,
  },
  {
    // the registration step put off: checkout says why it needs the phone
    id: 'checkout-no-phone-later',
    path: '/checkout',
    user: NO_PHONE_USER,
    setup: ({ api }) => fillCart(api, [['symphony', 10]]),
    act: async ({ page }) => {
      await sheet(page)
        .getByRole('button', { name: /Не сейчас|Hozir emas/ })
        .click();
      await sheet(page).waitFor({ state: 'detached' });
    },
    teardown: async ({ api }) => fillCart(api, []),
  },
  {
    id: 'checkout-empty',
    path: '/checkout',
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await emptyCart({ api, db });
    },
  },
  {
    id: 'checkout-error',
    path: '/checkout',
    setup: ({ api, db }) => checkoutReady(api, db, 'given'),
    act: ({ page }) => failRead(page, /\/checkout$/),
    teardown: checkoutDone,
  },
  { id: 'orders-more', ...ordersWorst },
  { id: 'orders-more-360', ...ordersWorst, width: 360 },
  {
    id: 'orders-error',
    path: '/orders',
    act: ({ page }) => failRead(page, /\/orders$/),
  },
  {
    id: 'orders-loading',
    path: '/orders',
    loading: true,
    act: ({ page }) => holdRead(page, /\/orders$/),
  },
  {
    // the title stands from the first frame: the number comes from the link
    id: 'order-loading',
    path: '/orders/1001',
    loading: true,
    act: ({ page }) => holdRead(page, /\/orders\/\d+$/),
  },
  // an old or someone else's link
  { id: 'order-not-found', path: '/orders/999999' },
  {
    // twelve lines, a seven-digit total, a typed address, the longest name and greeting, number 10 482
    id: 'order-detail-worst',
    path: '/orders/10482',
    fullPage: true,
    setup: async ({ api, db }) => {
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await priceyElysium(db);
      await numberFrom(db, 10482);
      await placeOrder(api, TWELVE_LINES, {
        recipientName: LONG_NAME,
        typed: TYPED_ADDRESS,
        gift: true,
        giftMessage: LONG_GREETING,
        comment: LONG_COMMENT,
      });
    },
    teardown: worstDone,
  },
  {
    id: 'profile',
    path: '/profile',
    // A customer who has shared the contact: Profile shows the account phone.
    setup: async ({ api }) => {
      const botToken = process.env.BOT_TOKEN ?? '';
      const res = await api.me.shareContact({
        body: {
          proof: signContact({
            botToken,
            userId: SHOT_USER.id,
            phone: '+998901234567',
            authDate: Math.floor(Date.now() / 1000),
          }),
        },
      });
      if (res.status !== 200) throw new Error(`profile shot: share contact failed ${res.status}`);
    },
  },
  { id: 'profile-no-phone', path: '/profile', user: NO_PHONE_USER },
  // Content (#21): the owner's promo banner on Home (the plain `home` shot is the Discovery fallback).
  {
    id: 'home-promo',
    path: '/',
    setup: async ({ api, db }) => {
      await forgetCity(api);
      await flagHome(db);
      await promoBanner(db, {
        titleRu: 'Осенняя подборка',
        titleUz: 'Kuzgi tanlov',
        subtitleRu: 'Тёплые, древесные ароматы на вечер',
        subtitleUz: 'Kechqurun uchun iliq, yogʻochli iforlar',
        priceLineRu: 'от 69 000 сум',
        priceLineUz: '69 000 soʻmdan',
      });
    },
    teardown: async ({ db }) => {
      await unflagHome(db);
      await clearBanners(db);
    },
  },
  {
    // Worst case: long unbroken words, a long price line.
    id: 'home-promo-worst',
    path: '/',
    setup: async ({ api, db }) => {
      await forgetCity(api);
      await flagHome(db);
      await promoBanner(db, {
        titleRu: 'Сверхдлинноеназваниеакциидляпроверкипереноса',
        titleUz: 'Juda uzun nomli aksiya sarlavhasi tekshiruv uchun',
        subtitleRu:
          'Очень длинный подзаголовок, который занимает несколько строк и проверяет, что блок не ломается',
        subtitleUz:
          'Bir necha qatorga cho‘ziladigan juda uzun qisqa matn, blok buzilmasligini tekshiradi',
        priceLineRu: 'от 1 234 567 сум за набор',
        priceLineUz: '1 234 567 soʻmdan toʻplam uchun',
      });
    },
    teardown: async ({ db }) => {
      await unflagHome(db);
      await clearBanners(db);
    },
  },
  // Info pages (#21): the long RU/UZ texts, a short one, and an unknown slug.
  { id: 'info-faq', path: '/info/faq', fullPage: true },
  { id: 'info-about', path: '/info/about' },
  { id: 'info-contacts', path: '/info/contacts' },
  { id: 'info-not-found', path: '/info/nope' },
  // While the body loads (a fresh app: Profile's list is not cached, so the title is a bar too),
  // and a failed read.
  {
    id: 'info-loading',
    path: '/info/faq',
    loading: true,
    act: ({ page }) => holdRead(page, /\/content\/pages\/faq$/),
  },
  {
    id: 'info-error',
    path: '/info/faq',
    act: ({ page }) => failRead(page, /\/content\/pages\/faq$/),
  },
  // Worst cases (break-ui): a ~2 000-word page with every block, the 80-character UZ title with ʻ,
  // placeholders and refused link targets; a page the owner left empty; the long title in
  // Profile's list; a promo banner at every field's limit.
  { id: 'info-long', path: '/info/about', fullPage: true, ...onInfoPage('about', LONG_PAGE) },
  { id: 'info-empty', path: '/info/offer', ...onInfoPage('offer', { bodyRu: '', bodyUz: '' }) },
  {
    id: 'profile-long-title',
    path: '/profile',
    fullPage: true,
    ...onInfoPage('about', { titleRu: LONG_PAGE.titleRu, titleUz: LONG_PAGE.titleUz }),
  },
  {
    id: 'home-promo-limit',
    path: '/',
    setup: async ({ api, db }) => {
      await forgetCity(api);
      await promoBanner(db, LIMIT_BANNER);
    },
    teardown: ({ db }) => clearBanners(db),
  },
  // the narrowest phone, with the banner and the slogan at their limits (one slogan line)
  {
    id: 'home-content-limit-360',
    path: '/',
    width: 360,
    setup: async ({ api, db }) => {
      await forgetCity(api);
      await promoBanner(db, LIMIT_BANNER);
      await sloganAtLimit.setup({ db });
    },
    teardown: async ({ db }) => {
      await clearBanners(db);
      await sloganAtLimit.teardown({ db });
    },
  },
  // Cart (#18): lines with a stepper and a bin, the Sage thread, the dark totals block.
  {
    id: 'cart-lines',
    path: '/cart',
    fullPage: true,
    setup: async ({ api }) => {
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
    },
    teardown: emptyCart,
  },
  {
    id: 'cart-nudge',
    path: '/cart',
    fullPage: true,
    setup: async ({ api }) => {
      await forgetCity(api);
      // 218 000: a gap of 32 000, so 10 ml bottles can close it and the suggestions show.
      await fillCart(api, [
        ['symphony', 10],
        ['tygar', 30],
      ]);
    },
    teardown: emptyCart,
  },
  {
    id: 'cart-sold-out',
    path: '/cart',
    fullPage: true,
    setup: async ({ api, db }) => {
      await chooseCity(api);
      await db.restore('power-of-you');
      await fillCart(api, [
        ['symphony', 10, 2],
        ['power-of-you', 10],
      ]);
      await db.setOnHand('power-of-you', 0);
    },
    teardown: emptyCart,
  },
  {
    id: 'cart-free-delivery',
    path: '/cart',
    fullPage: true,
    setup: async ({ api }) => {
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 30],
        ['tygar', 30],
      ]);
    },
    teardown: emptyCart,
  },
  // An applied discount and a line capped at what is left, on fixtures (no discount source exists yet).
  { id: 'cart-discount', path: '/dev/cart?data=discount', fullPage: true, act: hideFixtureToggle },
  { id: 'cart-empty', path: '/cart', setup: emptyCart },
  // The worst case on fixtures (src/dev/CartFixtures.tsx): twelve lines, a 40-character name,
  // quantity 99, a seven-digit total, the longest city. In the viewport, mid-scroll, the totals stay
  // above the tab bar while the lines run under them; the full page shows every line.
  {
    id: 'cart-worst',
    path: '/dev/cart?data=worst',
    act: async ({ page }) => {
      await hideFixtureToggle({ page });
      await page.evaluate(() => window.scrollTo(0, 700));
    },
  },
  { id: 'cart-worst-full', path: '/dev/cart?data=worst', fullPage: true, act: hideFixtureToggle },
  {
    id: 'cart-worst-nudge',
    path: '/dev/cart?data=worst-nudge',
    fullPage: true,
    act: hideFixtureToggle,
  },
  { id: 'cart-unavailable', path: '/dev/cart?data=unavailable', act: hideFixtureToggle },
  // Promo codes (#29): the field typed, a code applied through the real API, the attempt limit,
  // then every reason the quote can refuse a code with (fixtures: the reasons need orders and dates).
  {
    // #35: `l_<code>` lands on the fragrance the link points at
    id: 'campaign-landing',
    path: '/',
    startParam: 'l_malika-nov',
    setup: async ({ api, db }) => {
      await forgetCampaign({ api, db });
      await shotCampaign(db, { promoActive: true });
      await chooseCity(api);
      await fillCart(api, [['tygar', 30]]);
    },
    act: async ({ page }) => {
      await page.waitForURL('**/p/symphony');
      await page.getByRole('heading').first().waitFor();
    },
    teardown: forgetCampaign,
  },
  {
    // #35: ... and the link's promo code is already in the cart
    id: 'campaign-cart-prefilled',
    path: '/',
    startParam: 'l_malika-nov',
    fullPage: true,
    setup: async ({ api, db }) => {
      await forgetCampaign({ api, db });
      await shotCampaign(db, { promoActive: true });
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 30],
        ['tygar', 30],
      ]);
    },
    act: async ({ page }) => {
      await page.waitForURL('**/p/symphony');
      // the card has no tab bar: a client-side move to the cart, as a back-and-forth would be
      await page.evaluate(() => {
        history.pushState({}, '', '/cart');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByTestId('promo-input').waitFor();
    },
    teardown: forgetCampaign,
  },
  {
    // #35: a prefilled code that does not apply says why; the source is still kept
    id: 'campaign-cart-invalid',
    path: '/',
    startParam: 'l_malika-nov',
    fullPage: true,
    setup: async ({ api, db }) => {
      await forgetCampaign({ api, db });
      await shotCampaign(db, { promoActive: false });
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 30],
        ['tygar', 30],
      ]);
    },
    act: async ({ page }) => {
      await page.waitForURL('**/p/symphony');
      // the card has no tab bar: a client-side move to the cart, as a back-and-forth would be
      await page.evaluate(() => {
        history.pushState({}, '', '/cart');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByTestId('promo-input').waitFor();
    },
    teardown: forgetCampaign,
  },
  {
    id: 'cart-promo-typed',
    path: '/cart',
    fullPage: true,
    setup: async ({ api, db }) => {
      await forgetPromo({ api, db });
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 30],
        ['tygar', 30],
      ]);
    },
    act: async ({ page }) => typePromo(page, 'bloger10'),
    teardown: emptyCart,
  },
  {
    id: 'cart-promo-applied',
    path: '/cart',
    fullPage: true,
    setup: async ({ api, db }) => {
      await shotPromo(db);
      await forgetPromo({ api, db });
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 30],
        ['tygar', 30],
      ]);
      const res = await api.cart.applyPromoCode({ body: { code: 'bloger10' } });
      if (res.status !== 200) throw new Error(`apply: HTTP ${res.status}`);
    },
    teardown: async (ctx) => {
      await forgetPromo(ctx);
      await emptyCart(ctx);
    },
  },
  {
    // One code a window: the second one typed is refused until the window ends.
    id: 'cart-promo-wait',
    path: '/cart',
    fullPage: true,
    setup: async ({ api, db }) => {
      await shotPromo(db);
      await forgetPromo({ api, db });
      await db.query(
        `insert into settings (key, value) values ('promo.attemptLimit', '1')
         on conflict (key) do update set value = excluded.value`,
      );
      await fillCart(api, [['symphony', 30]]);
      const res = await api.cart.applyPromoCode({ body: { code: 'LUMMI' } });
      if (res.status !== 200) throw new Error(`apply: HTTP ${res.status}`);
    },
    act: async ({ page }) => {
      await typePromo(page, 'BLOGER10');
      await page.getByTestId('promo-apply').click();
      await page.getByTestId('promo-status').waitFor();
    },
    teardown: async (ctx) => {
      await forgetPromo(ctx);
      await emptyCart(ctx);
    },
  },
  ...[
    'unknown',
    'inactive',
    'expired',
    'exhausted',
    'already-used',
    'not-new-customer',
    'below-minimum',
    'no-eligible-items',
  ].map((reason) => ({
    id: `cart-promo-${reason}`,
    path: `/dev/cart?data=promo-${reason}`,
    act: async ({ page }: { page: Page }) => {
      await hideFixtureToggle({ page });
      // the field sits under the sticky totals until the page is scrolled to its end
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    },
  })),
  {
    // The keyboard is up: Telegram's WebView shrinks to what is left above it (Android), so the
    // field has to clear the floating tab bar sitting on the keyboard, not just the screen edge.
    id: 'cart-promo-typing',
    path: '/cart',
    setup: async ({ api, db }) => {
      await forgetPromo({ api, db });
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 30],
        ['tygar', 30],
      ]);
    },
    act: async ({ page }) => {
      await page.getByTestId('promo-input').focus();
      await page.setViewportSize({ width: page.viewportSize()?.width ?? 390, height: 500 });
      await page.waitForTimeout(300); // the keyboard slides up
      await page.keyboard.type('bloger10');
    },
    teardown: emptyCart,
  },
  {
    // The request is on its way: the button holds its width and spins.
    id: 'cart-promo-applying',
    path: '/cart',
    loading: true,
    setup: async ({ api, db }) => {
      await shotPromo(db);
      await forgetPromo({ api, db });
      await chooseCity(api);
      await fillCart(api, [
        ['symphony', 30],
        ['tygar', 30],
      ]);
    },
    act: async ({ page }) => {
      await page.route('**/api/cart/promo-code', () => undefined);
      await typePromo(page, 'bloger10');
      await page.getByTestId('promo-apply').click();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    },
    teardown: async (ctx) => {
      await forgetPromo(ctx);
      await emptyCart(ctx);
    },
  },
  // The applied code on a 360 px Android: the field, its line and the totals' source caption.
  {
    id: 'cart-promo-applied-360',
    path: '/dev/cart?data=promo-applied',
    width: 360,
    fullPage: true,
    act: hideFixtureToggle,
  },
  // break-ui (#29), captured into shots/29/worst-case/: the 32-character code with a seven-digit
  // fixed discount, a 100 % code (the delivery is still paid: discounts never touch it), and the
  // longest UZ refusal (the 32-character code under a seven-digit minimum) at 360 px.
  {
    id: 'cart-promo-worst',
    path: '/dev/cart?data=promo-worst',
    fullPage: true,
    act: hideFixtureToggle,
  },
  {
    id: 'cart-promo-worst-360',
    path: '/dev/cart?data=promo-worst',
    width: 360,
    fullPage: true,
    act: hideFixtureToggle,
  },
  {
    id: 'cart-promo-full',
    path: '/dev/cart?data=promo-full',
    fullPage: true,
    act: hideFixtureToggle,
  },
  {
    id: 'cart-promo-worst-refused-360',
    path: '/dev/cart?data=promo-worst-refused',
    width: 360,
    fullPage: true,
    act: hideFixtureToggle,
  },
  {
    // The cart request never answers: the cart's own skeleton.
    id: 'cart-loading',
    path: '/cart',
    setup: emptyCart,
    loading: true,
    act: async ({ page }) => {
      await page.route('**/api/cart*', () => undefined);
      await page.reload();
      await page.locator('[data-skeleton]').first().waitFor();
    },
  },
  {
    id: 'cart-error',
    path: '/cart',
    setup: emptyCart,
    act: async ({ page }) => {
      await page.route('**/api/cart*', (route) => route.abort());
      await page.reload();
      await page.getByRole('button', { name: /Повторить|Qayta urinish/ }).waitFor();
    },
  },
  // The fragrance card's dock once the volume is in the cart.
  {
    id: 'fragrance-in-cart',
    path: '/p/symphony',
    setup: ({ api }) => fillCart(api, [['symphony', 10]]),
    teardown: emptyCart,
  },
  {
    // «В корзину» once the last unit is already in the cart: the server caps it, «Осталось 1» shows.
    id: 'fragrance-capped',
    path: '/p/symphony',
    setup: async ({ api, db }) => {
      await db.setOnHand('symphony', 1);
      await fillCart(api, [['symphony', 10]]);
    },
    teardown: emptyCart,
    act: async ({ page }) => {
      await page.getByRole('button', { name: /В корзину|Savatga/ }).click();
      await page
        .getByRole('status')
        .filter({ hasText: /Осталось|Qoldi/ })
        .waitFor();
    },
  },
  // Fragrance card (#8): the seed catalog, real fragrances. The long ones stress the lockup.
  { id: 'fragrance', path: '/p/symphony', fullPage: true },
  { id: 'fragrance-long-name', path: '/p/elysium-pour-homme-parfum', fullPage: true },
  { id: 'fragrance-long-brand', path: '/p/baccarat-rouge-540', fullPage: true },
  {
    // The seed has no markdown: put one on the 10 ml bottle of Tygar (the volume the card opens on).
    id: 'fragrance-sale',
    path: '/p/tygar',
    fullPage: true,
    setup: async ({ db }) => db.markdown('tygar', 10, 55_200, 5),
    teardown: async ({ db }) => db.restore('tygar'),
  },
  {
    // Every volume sold out: the card still opens and says so.
    id: 'fragrance-sold-out',
    path: '/p/ink-mark',
    fullPage: true,
    setup: async ({ db }) => db.setOnHand('ink-mark', 0),
    teardown: async ({ db }) => db.restore('ink-mark'),
  },
  {
    // The seed has no hits and no Uzum links: a hit with the longest family and «Купить на Uzum».
    id: 'fragrance-hit-uzum',
    path: '/p/power-of-you',
    fullPage: true,
    setup: async ({ db }) => {
      await db.query(
        `update fragrances set is_hit = true, uzum_url = 'https://uzum.uz/ru/shop/lummi' where slug = $1`,
        ['power-of-you'],
      );
    },
    teardown: async ({ db }) => {
      await db.query(`update fragrances set is_hit = false, uzum_url = null where slug = $1`, [
        'power-of-you',
      ]);
    },
  },
  { id: 'fragrance-not-found', path: '/p/no-such-scent' },
  {
    // «Похожие ароматы» at the foot of the card (the curated ones, then the same family and type).
    id: 'fragrance-similar',
    path: '/p/symphony',
    act: async ({ page }) => {
      const heading = page.getByRole('heading', { name: /Похожие ароматы|Oʻxshash iforlar/ });
      await heading.waitFor();
      await page.locator('[data-skeleton]').first().waitFor({ state: 'detached' });
      await heading.scrollIntoViewIfNeeded();
      await heading.evaluate((h) => h.scrollIntoView({ block: 'start' }));
    },
  },
  // The card on dev fixtures (src/dev/fragrance-fixtures.ts): the realistic worst case (long name
  // and brand, no family, every volume on sale, a seven-digit price, a missing photo), a fragrance
  // sold in one volume, and one with nothing optional (no volumes, notes or key notes).
  { id: 'fragrance-worst', path: '/dev/fragrance?data=worst', fullPage: true },
  { id: 'fragrance-one-volume', path: '/dev/fragrance?data=one', fullPage: true },
  { id: 'fragrance-empty', path: '/dev/fragrance?data=empty', fullPage: true },
  // Search (#16): the empty field with its hint, suggestions while typing (the fifth is the
  // longest attribution, Boadicea the Victorious), the submitted result list, the 30-result cap
  // («ambra»), nothing found, a typo («aventuss»), a UZ note («zanjabil» is ginger), a long UZ
  // query, all on the seed catalog; then loading, error and the keyboard-shrunk viewport.
  { id: 'search-hint', path: '/search' },
  { id: 'search-suggestions', path: '/search?q=bla' },
  { id: 'search-results', path: '/search?q=vanil&s=1', fullPage: true },
  { id: 'search-results-30', path: '/search?q=ambra&s=1', fullPage: true },
  { id: 'search-nothing-found', path: '/search?q=zzqx&s=1' },
  { id: 'search-typo', path: '/search?q=aventuss&s=1' },
  { id: 'search-uz-note', path: '/search?q=zanjabil&s=1' },
  {
    id: 'search-long-query',
    path: `/search?q=${encodeURIComponent('kechqurun kiyiladigan yogʻochli ziravorli iforlar')}&s=1`,
  },
  {
    // The request never answers: the result cards' skeleton.
    id: 'search-loading',
    path: '/search',
    loading: true,
    act: async ({ page }) => {
      await page.route('**/catalog/search*', () => undefined);
      await searchFor(page, 'vanil');
      await page.locator('[data-skeleton]').first().waitFor();
    },
  },
  {
    id: 'search-suggest-loading',
    path: '/search',
    loading: true,
    act: async ({ page }) => {
      await page.route('**/catalog/suggest*', () => undefined);
      await page.getByRole('searchbox').fill('bla');
      await page.locator('[data-skeleton]').first().waitFor();
    },
  },
  {
    // The request fails (and its one retry): the error with «Повторить».
    id: 'search-error',
    path: '/search',
    act: async ({ page }) => {
      await page.route('**/catalog/search*', (route) => route.abort());
      await searchFor(page, 'vanil');
      await page.getByRole('button', { name: /Повторить|Qayta urinish/ }).waitFor();
    },
  },
  {
    // The keyboard is up: Telegram shrinks the viewport, the list scrolls under the field.
    id: 'search-keyboard',
    path: '/search?q=bla',
    act: async ({ page }) => {
      await page.getByRole('searchbox').focus();
      await page.setViewportSize({ width: 390, height: 480 });
      await page.evaluate(() => window.scrollBy(0, 160));
    },
  },
  // Sets (#22): the «Наборы» page, the Discovery set, the builder and the cart with set lines.
  { id: 'sets-catalog', path: '/catalog?type=sets' },
  { id: 'set-discovery', path: '/sets/discovery', fullPage: true },
  {
    // Boxes ran out: the dock says so and the set stays on view.
    id: 'set-discovery-sold-out',
    path: '/sets/discovery',
    setup: async ({ db }) => void (await db.query('update discovery_set set on_hand = 0')),
    teardown: async ({ db }) => void (await db.query('update discovery_set set on_hand = 10')),
  },
  { id: 'builder-empty', path: '/sets/builder' },
  { id: 'builder-3', path: '/sets/builder', act: pickForBuilder(3) },
  { id: 'builder-3-360', path: '/sets/builder', width: 360, act: pickForBuilder(3) },
  { id: 'builder-5', path: '/sets/builder', act: pickForBuilder(5) },
  {
    // A chosen fragrance's 10 ml ran out before the tap: the server answers 409 naming it, the page
    // names it over the button, and the box drops it (four left to fill one).
    id: 'builder-unavailable',
    path: '/sets/builder',
    act: async ({ page, db }) => {
      await pickForBuilder(5)({ page });
      await sellOutPicked(page, db);
      await page.getByRole('button', { name: /В корзину|Savatga/ }).click();
      await page.getByTestId('dock-alert').waitFor();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="pick"][data-chosen="true"]').length === 4,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    teardown: async ({ db }) => {
      if (builderVictim) await db.restore(builderVictim);
      builderVictim = undefined;
    },
  },
  {
    // The add failed on the way (no connection): «Повторить» over the button, the five kept.
    id: 'builder-failed',
    path: '/sets/builder',
    act: async ({ page }) => {
      await pickForBuilder(5)({ page });
      await page.route('**/cart/sets/builder', (route) => route.abort());
      await page.getByRole('button', { name: /В корзину|Savatga/ }).click();
      await page.getByRole('button', { name: /Повторить|Qayta urinish/ }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  {
    id: 'builder-loading',
    path: '/sets/builder',
    loading: true,
    act: ({ page }) => holdRead(page, /\/sets\/builder$/),
  },
  {
    id: 'builder-error',
    path: '/sets/builder',
    act: ({ page }) => failRead(page, /\/sets\/builder$/),
  },
  {
    id: 'set-discovery-loading',
    path: '/sets/discovery',
    loading: true,
    act: ({ page }) => holdRead(page, /\/sets\/discovery$/),
  },
  {
    id: 'set-discovery-error',
    path: '/sets/discovery',
    act: ({ page }) => failRead(page, /\/sets\/discovery$/),
  },
  {
    id: 'cart-sets',
    path: '/cart',
    setup: async ({ api }) => {
      await fillCart(api, [['symphony', 30]]);
      await api.cart.addDiscovery({ body: { qty: 2 } });
      const options = await api.sets.builder();
      if (options.status !== 200) throw new Error(`builder: HTTP ${options.status}`);
      const slugs = options.body.options.slice(0, 5).map((o) => o.slug);
      const res = await api.cart.addBuilder({ body: { slugs, qty: 1 } });
      if (res.status !== 200) throw new Error(`builder add: HTTP ${res.status}`);
    },
    teardown: emptyCart,
    fullPage: true,
  },
  {
    // One 10 ml left, shared: the volume line takes it, so the builder set after it cannot be
    // bought (the server shares each 10 ml across the lines in order).
    id: 'cart-sets-shared',
    path: '/cart',
    setup: async ({ api, db }) => {
      await fillCart(api, [['symphony', 10]]);
      const res = await api.cart.addBuilder({ body: { slugs: SOLD_FIVE, qty: 1 } });
      if (res.status !== 200) throw new Error(`builder add: HTTP ${res.status}`);
      await db.query(`update volumes set on_hand = 1 where ml = 10 and fragrance_id =
        (select id from fragrances where slug = 'symphony')`);
    },
    teardown: async (ctx) => {
      await emptyCart(ctx);
      for (const slug of SOLD_FIVE) await ctx.db.restore(slug);
    },
    fullPage: true,
  },
  // break-ui (#22): the longest five in the Discovery set, a seven-digit set price, 99 of each set.
  {
    id: 'set-discovery-worst',
    path: '/sets/discovery',
    fullPage: true,
    setup: ({ db }) => worstSets(db),
    teardown: ({ db }) => bestSets(db),
  },
  {
    id: 'set-discovery-worst-360',
    path: '/sets/discovery',
    width: 360,
    fullPage: true,
    setup: ({ db }) => worstSets(db),
    teardown: ({ db }) => bestSets(db),
  },
  {
    // the Discovery card sold out beside its seven-digit price, on the narrowest phone
    id: 'sets-catalog-worst-360',
    path: '/catalog?type=sets',
    width: 360,
    setup: async ({ db }) => {
      await worstSets(db);
      await db.query('update discovery_set set on_hand = 0');
    },
    teardown: ({ db }) => bestSets(db),
  },
  {
    id: 'home-sets-worst-360',
    path: '/',
    width: 360,
    setup: ({ db }) => worstSets(db),
    teardown: ({ db }) => bestSets(db),
  },
  {
    id: 'builder-worst-360',
    path: '/sets/builder',
    width: 360,
    setup: ({ db }) => worstSets(db),
    act: ({ page }) => pickByName(page, LONG_FIVE_NAMES),
    teardown: ({ db }) => bestSets(db),
  },
  {
    // all five chosen ran out at once: the 409 names every one of them over the button
    id: 'builder-gone-worst-360',
    path: '/sets/builder',
    width: 360,
    setup: ({ db }) => worstSets(db),
    act: async ({ page, db }) => {
      await pickByName(page, LONG_FIVE_NAMES);
      await db.query(`update volumes set on_hand = 0 where ${tenMlOf}`, [LONG_FIVE]);
      await page.getByRole('button', { name: /В корзину|Savatga/ }).click();
      await page.getByTestId('dock-alert').waitFor();
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="pick"][data-chosen="true"]'),
      );
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    teardown: ({ db }) => bestSets(db),
  },
  {
    id: 'cart-sets-worst',
    path: '/cart',
    fullPage: true,
    setup: async ({ api, db }) => {
      await worstSets(db);
      await fillWorstSetsCart(api, db);
    },
    teardown: async (ctx) => {
      await emptyCart(ctx);
      await bestSets(ctx.db);
    },
  },
  {
    id: 'cart-sets-worst-360',
    path: '/cart',
    width: 360,
    fullPage: true,
    setup: async ({ api, db }) => {
      await worstSets(db);
      await fillWorstSetsCart(api, db);
    },
    teardown: async (ctx) => {
      await emptyCart(ctx);
      await bestSets(ctx.db);
    },
  },
  {
    id: 'order-detail-sets-worst',
    path: '/orders',
    fullPage: true,
    setup: async ({ api, db }) => {
      await worstSets(db);
      await sharePhone(api);
      await clearOrders(db, { consent: 'given' });
      await placeOrder(api, [], {
        fill: async (a) => {
          await fillCart(a, []);
          await a.cart.addDiscovery({ body: { qty: 99 } });
          await a.cart.addBuilder({ body: { slugs: LONG_FIVE, qty: 99 } });
        },
      });
    },
    act: async ({ page }) => openFirstOrder(page),
    teardown: async (ctx) => {
      await checkoutDone(ctx);
      await bestSets(ctx.db);
    },
  },
  // FragranceListCard on dev fixtures: grid (the catalog's), row and compact, worst cases included.
  { id: 'list-cards', path: '/dev/list', fullPage: true },
  { id: 'session-reopen', path: '/', initDataAgeSeconds: 3600 },
  // Dev-only component gallery (src/dev/Gallery.tsx): every base component in every state.
  { id: 'ui-gallery', path: '/dev/ui', fullPage: true },
  { id: 'ui-sheet', path: '/dev/sheet' },
  // The registration step (contact + write access); its dev trigger is in the gallery.
  ...registrationStates,
  ...shortcutScreens,
  ...polishScreens,
  ...worstShortcutScreens,
  ...birthdayScreens(),
  ...upgradeRightScreens(),
  ...favouriteScreens(),
];

/* The birthday coupon written straight to the dev DB (#30); the upgrade-right shots use it too. */
/** Today on the Tashkent calendar, in SQL. */
const today = `(now() at time zone 'Asia/Tashkent')::date`;
const forgetBirthday = async (db: ShotDb) => {
  await db.query(
    `delete from birthday_coupons where customer_id in (select id from customers where telegram_id = $1)`,
    [SHOT_USER.id],
  );
  await db.query(
    `update customers set birth_date = null, birth_date_set_at = null where telegram_id = $1`,
    [SHOT_USER.id],
  );
};
/** Born 30 years ago the day after tomorrow, entered two months ago; this year's coupon is out. */
const withCoupon = async (db: ShotDb) => {
  await forgetBirthday(db);
  await db.query(
    `update customers set birth_date = (${today} + 2 - interval '30 years')::date,
       birth_date_set_at = now() - interval '60 days' where telegram_id = $1`,
    [SHOT_USER.id],
  );
  await db.query(
    `insert into birthday_coupons (customer_id, birthday_year, birthday, percent, max_amount, issued_at, expires_at)
     select id, extract(year from ${today} + 2)::int, ${today} + 2, 20, 100000,
       now() - interval '1 day', ((${today} + 10)::timestamp at time zone 'Asia/Tashkent')
     from customers where telegram_id = $1`,
    [SHOT_USER.id],
  );
};
/**
 * Birthday coupons (#30): «Мои скидки» in Profile, the one-time date of birth (Profile sheet and
 * checkout's optional field), and the coupon as the cart's one discount, also when an entered
 * promo code wins. The coupon is written straight to the dev DB, as the 10:00 job would issue it
 * (shots cannot wait for 10:00): birthday in two days, so it opened yesterday and has 9 days left.
 */
function birthdayScreens(): ScreenDef[] {
  const done = async (ctx: { api: ApiClient; db: ShotDb }) => {
    await forgetPromo(ctx);
    await clearOrders(ctx.db);
    await forgetBirthday(ctx.db);
    await emptyCart(ctx);
  };
  const twoBottles: [string, 30][] = [
    ['symphony', 30],
    ['tygar', 30],
  ];
  return [
    {
      id: 'profile-discounts-coupon',
      path: '/profile',
      fullPage: true,
      setup: async ({ api, db }) => {
        await sharePhone(api);
        await withCoupon(db);
      },
      act: async ({ page }) => void (await page.getByTestId('birthday-coupon').waitFor()),
      teardown: done,
    },
    {
      // a date entered, no coupon yet: when the next one opens, and whom to ask about a wrong date
      id: 'profile-discounts-upcoming',
      path: '/profile',
      fullPage: true,
      setup: async ({ api, db }) => {
        await sharePhone(api);
        await forgetBirthday(db);
        await db.query(
          `update customers set birth_date = '1996-03-14', birth_date_set_at = now() - interval '60 days'
           where telegram_id = $1`,
          [SHOT_USER.id],
        );
      },
      act: async ({ page }) => void (await page.getByTestId('birthday-card').waitFor()),
      teardown: done,
    },
    {
      // no date yet and no consent: the sheet asks both, entered once
      id: 'profile-birth-date-sheet',
      path: '/profile',
      setup: async ({ api, db }) => {
        await sharePhone(api);
        await forgetBirthday(db);
        await clearOrders(db, { consent: 'none' });
      },
      act: async ({ page }) => {
        await page.getByTestId('birth-date-enter').click();
        await sheet(page).waitFor();
        await page.getByTestId('birth-date-field').pressSequentially('14031996');
      },
      teardown: async (ctx) => {
        await clearOrders(ctx.db, { consent: 'given' });
        await done(ctx);
      },
    },
    {
      // checkout's optional field while there is no date, typed in
      id: 'checkout-birth-date',
      path: '/checkout',
      fullPage: true,
      setup: async ({ api, db }) => {
        await forgetBirthday(db);
        await checkoutReady(api, db, 'none');
      },
      act: async ({ page }) => {
        await pickFirstPoint(page);
        await page.getByTestId('birth-date-field').pressSequentially('14031996');
        await page.getByTestId('birth-date-field').blur();
      },
      teardown: async (ctx) => {
        await clearOrders(ctx.db, { consent: 'given' });
        await done(ctx);
      },
    },
    {
      // the coupon applies by itself: 20 % of 298 000, delivery paid under the "after" base
      id: 'cart-birthday',
      path: '/cart',
      fullPage: true,
      setup: async ({ api, db }) => {
        await sharePhone(api);
        await forgetPromo({ api, db });
        await chooseCity(api);
        await withCoupon(db);
        await fillCart(api, twoBottles);
      },
      act: async ({ page }) => void (await page.getByTestId('discount-row').waitFor()),
      teardown: done,
    },
    {
      // an entered promo code wins over the cheaper coupon (ADR 0002), which waits in Profile
      id: 'cart-birthday-promo-wins',
      path: '/cart',
      fullPage: true,
      setup: async ({ api, db }) => {
        await sharePhone(api);
        await shotPromo(db);
        await forgetPromo({ api, db });
        await chooseCity(api);
        await withCoupon(db);
        await fillCart(api, twoBottles);
        const res = await api.cart.applyPromoCode({ body: { code: 'bloger10' } });
        if (res.status !== 200) throw new Error(`apply: HTTP ${res.status}`);
      },
      act: async ({ page }) => void (await page.getByTestId('discount-row').waitFor()),
      teardown: done,
    },
    {
      // the checkout's summary with the coupon, the date already known (no field)
      id: 'checkout-birthday',
      path: '/checkout',
      fullPage: true,
      setup: async ({ api, db }) => {
        await checkoutReady(api, db, 'given');
        await withCoupon(db);
      },
      act: async ({ page }) => pickFirstPoint(page),
      teardown: done,
    },
  ];
}

/** The five fragrances of the shots' set; the Discovery set is put back to the seed's afterwards. */
const RIGHT_FIVE = ['symphony', 'tygar', 'ink-mark', 'power-of-you', 'rain-tea'];

/**
 * Upgrade rights (#38): the fragrance card with «Скидка за набор», the right as the cart's one
 * discount, an entered promo code winning over it, and «Мои скидки» with a right and a birthday
 * coupon. The shopper orders a Discovery set of `RIGHT_FIVE` through the API; it is marked
 * delivered and its right written straight to the dev DB, as the «Доставлен» move would open it
 * (five days ago, so 25 days are left).
 */
function upgradeRightScreens(): ScreenDef[] {
  const withRight = async ({ api, db }: { api: ApiClient; db: ShotDb }) => {
    await sharePhone(api);
    await chooseCity(api);
    await clearOrders(db);
    await db.query('update discovery_set set on_hand = 10');
    await db.query('delete from discovery_set_items');
    await db.query(
      `insert into discovery_set_items (position, fragrance_id)
       select i, (select id from fragrances where slug = ($1::text[])[i])
       from generate_subscripts($1::text[], 1) as i`,
      [RIGHT_FIVE],
    );
    await placeOrder(api, [], {
      fill: async (a) => {
        await fillCart(a, []);
        const res = await a.cart.addDiscovery({ body: { qty: 1 } });
        if (res.status !== 200) throw new Error(`discovery add: HTTP ${res.status}`);
      },
    });
    const mine = `select id from orders where customer_id = (select id from customers where telegram_id = $1)`;
    await db.query(
      `update orders set status = 'delivered', updated_at = now() where id in (${mine})`,
      [SHOT_USER.id],
    );
    await db.query(
      `insert into upgrade_rights (customer_id, source, source_order_id, source_position, source_unit,
         fragrances, percent, opened_at, expires_at)
       select o.customer_id, 'set', o.id, l.position, 0, l.set_composition, 20,
         now() - interval '5 days', ((${today} + 26)::timestamp at time zone 'Asia/Tashkent')
       from orders o join order_lines l on l.order_id = o.id
       where o.id in (${mine}) and l.kind = 'discovery_set'`,
      [SHOT_USER.id],
    );
  };
  const done = async (ctx: { api: ApiClient; db: ShotDb }) => {
    await forgetPromo(ctx);
    await clearOrders(ctx.db);
    await forgetBirthday(ctx.db);
    await bestSets(ctx.db);
    await emptyCart(ctx);
  };
  // 50 ml of a covered fragrance and a 10 ml of another: the right takes 20 % of the 50 ml and
  // delivery stays free, the threshold counted before the discount
  const rightCart: [string, 10 | 30 | 50][] = [
    ['symphony', 50],
    ['baccarat-rouge-540', 10],
  ];
  return [
    {
      id: 'card-set-discount',
      path: '/p/symphony',
      fullPage: true,
      setup: withRight,
      act: async ({ page }) => {
        await page.getByRole('radio', { name: /30/ }).click();
        await page.getByTestId('right-deal').waitFor();
      },
      teardown: done,
    },
    {
      id: 'cart-set-discount',
      path: '/cart',
      fullPage: true,
      setup: async (ctx) => {
        await forgetPromo(ctx);
        await withRight(ctx);
        await fillCart(ctx.api, rightCart);
      },
      act: async ({ page }) => void (await page.getByTestId('line-deal').waitFor()),
      teardown: done,
    },
    {
      // an entered promo code wins (ADR 0002); the right waits, «Применить скидку» takes the code out
      id: 'cart-set-discount-promo-wins',
      path: '/cart',
      fullPage: true,
      setup: async (ctx) => {
        await shotPromo(ctx.db);
        await forgetPromo(ctx);
        await withRight(ctx);
        await fillCart(ctx.api, rightCart);
        const res = await ctx.api.cart.applyPromoCode({ body: { code: 'bloger10' } });
        if (res.status !== 200) throw new Error(`apply: HTTP ${res.status}`);
      },
      act: async ({ page }) => void (await page.getByTestId('choice-better').waitFor()),
      teardown: done,
    },
    // the narrow Android check (360 px): the struck prices in the tiles and the dock, the cart's
    // long brand line beside the price
    {
      id: 'card-set-discount-360',
      path: '/p/symphony',
      width: 360,
      fullPage: true,
      setup: withRight,
      act: async ({ page }) => {
        await page.getByRole('radio', { name: /50/ }).click();
        await page.getByTestId('right-deal').waitFor();
      },
      teardown: done,
    },
    {
      id: 'cart-set-discount-360',
      path: '/cart',
      width: 360,
      fullPage: true,
      setup: async (ctx) => {
        await forgetPromo(ctx);
        await withRight(ctx);
        await fillCart(ctx.api, rightCart);
      },
      act: async ({ page }) => void (await page.getByTestId('line-deal').waitFor()),
      teardown: done,
    },
    {
      id: 'profile-discounts-right',
      path: '/profile',
      fullPage: true,
      setup: async (ctx) => {
        await withRight(ctx);
        await withCoupon(ctx.db);
      },
      act: async ({ page }) => {
        await page.getByTestId('upgrade-right').waitFor();
        await page.getByTestId('birthday-coupon').waitFor();
      },
      teardown: done,
    },
    ...discountChoiceScreens(withRight, done, rightCart),
  ];
}

/**
 * The cart's discount switch (#39, ADR 0002) on real API data: the set right (−43 800 on the
 * 50 ml, counted before it: 244 200) and the 20 % birthday coupon (−57 600, counted after it:
 * delivery comes back, 255 400), with the code BLOGER10 (−28 800, 259 200) where a screen enters
 * it. Taps go through the screen itself.
 */
function discountChoiceScreens(
  withRight: (ctx: { api: ApiClient; db: ShotDb }) => Promise<void>,
  done: (ctx: { api: ApiClient; db: ShotDb }) => Promise<void>,
  rightCart: [string, 10 | 30 | 50][],
): ScreenDef[] {
  const both = async (ctx: { api: ApiClient; db: ShotDb }) => {
    await forgetPromo(ctx);
    await withRight(ctx);
    await withCoupon(ctx.db);
    await fillCart(ctx.api, rightCart);
  };
  const withCode = async (ctx: { api: ApiClient; db: ShotDb }) => {
    await shotPromo(ctx.db);
    await both(ctx);
    const res = await ctx.api.cart.applyPromoCode({ body: { code: 'bloger10' } });
    if (res.status !== 200) throw new Error(`apply: HTTP ${res.status}`);
  };
  const checked = (page: Page, n: number) =>
    page.getByRole('radio').nth(n).and(page.locator('[aria-checked="true"]')).waitFor();
  return [
    {
      // no code: the server picked the set right; the coupon and «Не применять» with their totals
      id: 'cart-choice',
      path: '/cart',
      fullPage: true,
      setup: both,
      act: async ({ page }) => void (await page.getByTestId('discount-choice').waitFor()),
      teardown: done,
    },
    {
      // the entered code stays applied; the set right is cheaper and says by how much
      id: 'cart-choice-promo',
      path: '/cart',
      fullPage: true,
      setup: withCode,
      act: async ({ page }) => void (await page.getByTestId('choice-better').waitFor()),
      teardown: done,
    },
    {
      id: 'cart-choice-promo-360',
      path: '/cart',
      width: 360,
      fullPage: true,
      setup: withCode,
      act: async ({ page }) => void (await page.getByTestId('choice-better').waitFor()),
      teardown: done,
    },
    {
      // «Переключить»: the right applied, the code kept in its field and offered back in the list
      id: 'cart-choice-switched',
      path: '/cart',
      fullPage: true,
      setup: withCode,
      act: async ({ page }) => {
        await page.getByTestId('choice-better').getByRole('button').click();
        await checked(page, 0);
        await page.getByTestId('choice-better').waitFor({ state: 'detached' });
      },
      teardown: done,
    },
    {
      // «Не применять»: no discount, the coupon and the right kept for a later order
      id: 'cart-choice-none',
      path: '/cart',
      fullPage: true,
      setup: both,
      act: async ({ page }) => {
        await page.getByRole('radio').last().click();
        await checked(page, 2);
      },
      teardown: done,
    },
    {
      // the chosen coupon ended: the cart fell back to the set right and says so
      id: 'cart-choice-stale',
      path: '/cart',
      fullPage: true,
      setup: async (ctx) => {
        await both(ctx);
        const cart = await ctx.api.cart.get();
        if (cart.status !== 200) throw new Error(`cart: HTTP ${cart.status}`);
        const coupon = cart.body.discountOptions.find(
          (o) => o.discount?.type === 'birthday_coupon',
        );
        if (coupon?.discount?.type !== 'birthday_coupon') throw new Error('no coupon offered');
        const res = await ctx.api.cart.chooseDiscount({
          body: { type: 'birthday_coupon', id: coupon.discount.id },
        });
        if (res.status !== 200) throw new Error(`choose: HTTP ${res.status}`);
        await ctx.db.query(
          `update birthday_coupons set expires_at = now()
           where customer_id in (select id from customers where telegram_id = $1)`,
          [SHOT_USER.id],
        );
      },
      act: async ({ page }) => void (await page.getByTestId('choice-stale').waitFor()),
      teardown: done,
    },
  ];
}

/**
 * Favourites (#45): the heart on Home's, the catalog's and the fragrance card's photos, on the
 * Discovery set, and Profile → «Избранное». The hearts are saved through the real API as the
 * screenshot customer and taken away again.
 */
function favouriteScreens(): ScreenDef[] {
  const kept = ['baccarat-rouge-540', 'tygar', 'blue-sapphire', 'le-male-le-parfum'];
  const heart =
    (slugs: string[], set = false) =>
    async ({ api }: { api: ApiClient }) => {
      for (const slug of slugs) await api.favourites.add({ params: { target: slug } });
      if (set) await api.favourites.add({ params: { target: 'discovery-set' } });
    };
  const forget = async ({ api }: { api: ApiClient }) => {
    const ids = await api.favourites.ids();
    if (ids.status !== 200) return;
    for (const slug of ids.body.slugs) await api.favourites.remove({ params: { target: slug } });
    await api.favourites.remove({ params: { target: 'discovery-set' } });
  };
  return [
    { id: 'fav-home', path: '/', setup: heart(kept), teardown: forget },
    { id: 'fav-catalog', path: '/catalog', fullPage: true, setup: heart(kept), teardown: forget },
    {
      id: 'fav-catalog-360',
      path: '/catalog',
      width: 360,
      fullPage: true,
      setup: heart(kept),
      teardown: forget,
    },
    { id: 'fav-search', path: '/search?q=tygar', setup: heart(kept), teardown: forget },
    { id: 'fav-fragrance', path: '/p/tygar', setup: heart(['tygar']), teardown: forget },
    {
      id: 'fav-discovery-card',
      path: '/catalog?type=sets',
      setup: heart([], true),
      teardown: forget,
    },
    {
      id: 'fav-discovery-screen',
      path: '/sets/discovery',
      setup: heart([], true),
      teardown: forget,
    },
    {
      id: 'favourites',
      path: '/favourites',
      fullPage: true,
      setup: heart(kept, true),
      teardown: forget,
    },
    { id: 'favourites-empty', path: '/favourites' },
    {
      // two hearts, a seven-digit price and a sold-out one, on the narrow phone
      id: 'favourites-360',
      path: '/favourites',
      width: 360,
      fullPage: true,
      setup: async (ctx) => {
        await worstData.setup!(ctx);
        await heart(['elysium-pour-homme-parfum', 'blue-sapphire', 'tygar'])(ctx);
      },
      teardown: async (ctx) => {
        await forget(ctx);
        await worstData.teardown!(ctx);
      },
    },
  ];
}
