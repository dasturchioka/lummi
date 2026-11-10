import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  and,
  asc,
  auditLog,
  btsPoints,
  eq,
  fragrances,
  orders,
  outbox,
  receipts,
  regions,
} from '@lummi/db';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { OrderStatusService } from '../src/order-status/order-status.service';
import { pdfRenderSlots } from '../src/receipts/pdf-first-page';
import { receiptPdf } from './harness/pdf';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, TEST_SHOP_CARD, type TestApp } from './harness/test-app';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  t.edges.files.files.clear();
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

/** A shopper with a shared phone, signed in: their session token and a client bound to it. */
async function shopper(user: TestUser = ali, phone = '998901234567') {
  const { client, token } = await t.signIn(user);
  const proof = signContact({
    botToken: TEST_BOT_TOKEN,
    userId: user.id,
    phone,
    authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
  });
  if ((await client.me.shareContact({ body: { proof } })).status !== 200)
    throw new Error('contact');
  return { client, token };
}
type Shopper = Awaited<ReturnType<typeof shopper>>;

/** The checkout body for the cart as it is now, to a Samarkand point at the quoted total. */
async function orderBody(s: Shopper): Promise<CreateOrderBody> {
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  const checkout = await s.client.checkout.get({ query: { regionId: region!.id } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  return {
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998901234567',
    delivery: { kind: 'point', pointId: point!.id },
    consent: true,
    confirmedTotal: checkout.body.quote.total,
    confirmedDiscount: checkout.body.quote.discount,
    idempotencyKey: randomUUID(),
  };
}

/** One 10 ml of the first fragrance, ordered; returns the order number. */
async function placeOrder(s: Shopper) {
  const [f] = await t.db.select({ slug: fragrances.slug }).from(fragrances).limit(1);
  const add = await s.client.cart.addLine({ body: { slug: f!.slug, ml: 10, qty: 1 } });
  if (add.status !== 200) throw new Error(`add ${add.status}`);
  const res = await s.client.orders.create({ body: await orderBody(s) });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return res.body.number;
}

/** `POST /orders/:number/receipts` as the Mini App sends it: the raw file, its name in a header. */
async function upload(token: string | null, number: number, bytes: Uint8Array, name?: string) {
  const res = await fetch(`${t.baseUrl}/orders/${number}/receipts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(name ? { 'x-file-name': encodeURIComponent(name) } : {}),
    },
    body: bytes,
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** A receipt-like screenshot: a white page with dark bars, like a bank app's transfer screen. */
function receiptSvg(width: number, height: number) {
  const bars = Array.from({ length: 12 }, (_, i) => {
    const y = Math.round((height / 14) * (i + 1));
    const w = Math.round(width * (0.3 + ((i * 37) % 50) / 100));
    return `<rect x="${Math.round(width * 0.08)}" y="${y}" width="${w}" height="${Math.max(4, Math.round(height / 60))}" fill="#222"/>`;
  }).join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/><circle cx="${width / 2}" cy="${height / 9}" r="${Math.min(width, height) / 10}" fill="#9AA592"/>${bars}</svg>`,
  );
}
const png = (w = 1170, h = 2532) => sharp(receiptSvg(w, h)).png().toBuffer();

const jpeg = (w = 1170, h = 2532) => sharp(receiptSvg(w, h)).jpeg({ quality: 85 }).toBuffer();
const webp = (w = 1170, h = 2532) => sharp(receiptSvg(w, h)).webp().toBuffer();

/** The texts queued for the shopper (the outbox, ADR 0021), oldest first. */
const said = async () =>
  (await t.db.select().from(outbox).orderBy(asc(outbox.id))).map((r) => r.text);

/** The order's status as its shopper reads it. */
async function statusOf(s: Shopper, number: number) {
  const res = await s.client.orders.get({ params: { number } });
  if (res.status !== 200) throw new Error(`order ${res.status}`);
  return res.body.status;
}

/** The receipt rows of an order, oldest first: what the upload recorded. */
async function receiptRows(number: number) {
  const [o] = await t.db.select({ id: orders.id }).from(orders).where(eq(orders.number, number));
  return t.db.select().from(receipts).where(eq(receipts.orderId, o!.id)).orderBy(asc(receipts.id));
}

/** The private FileStore's keys (the fake edge), sorted. */
const storedKeys = () => [...t.edges.files.files.keys()].sort();

/** A manager rejects the receipt under check, as the admin panel will (#33): back to «Ожидает оплаты». */
async function rejectReceipt(number: number) {
  const [o] = await t.db.select({ id: orders.id }).from(orders).where(eq(orders.number, number));
  const manager = await t.managerSession();
  const out = await t.app
    .get(OrderStatusService)
    .transition(
      o!.id,
      'reject_receipt',
      { type: 'staff', id: manager.staff.id },
      'receipt_review',
      {
        reason: 'Сумма не совпадает',
      },
    );
  if (out.kind !== 'done') throw new Error(`reject: ${out.kind}`);
}

/** A file as the customer route serves it. */
async function fetchFile(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${t.baseUrl}${path}`, { headers });
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
}

function hamming(a: string, b: string) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x; x >>= 1n) n += Number(x & 1n);
  return n;
}

describe('receipt upload', () => {
  it('stores the receipt, moves the order to «Чек на проверке» and tells the shopper', async () => {
    const s = await shopper();
    const number = await placeOrder(s);

    const res = await upload(s.token, number, await png(), 'chek-1001.png');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      receipt: { fileName: 'chek-1001.png', kind: 'image' },
      order: { number, status: 'receipt_review' },
    });
    expect(await statusOf(s, number)).toBe('receipt_review');
    expect(await said()).toContainEqual(expect.stringMatching(`^Чек к заказу № ${number} получен`));
    const [row] = await receiptRows(number);
    expect(row).toMatchObject({ verdict: 'pending', source: 'miniapp', kind: 'png' });
  });

  it('keeps the original under a random name in private storage, the AI image beside it, and both hashes', async () => {
    const s = await shopper();
    const number = await placeOrder(s);
    const original = await png();

    await upload(s.token, number, original, 'chek.png');

    const keys = storedKeys();
    expect(keys).toHaveLength(2);
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const [judgeKey, originalKey] = keys as [string, string];
    expect(originalKey).toMatch(new RegExp(`^private/receipts/${uuid}\\.png$`));
    expect(judgeKey).toBe(originalKey.replace(/\.png$/, '.judge.png'));
    expect(Buffer.from(t.edges.files.files.get(originalKey)!).equals(original)).toBe(true);
    // a 1170 x 2532 screenshot comes down to the judge's 1568 px
    const judged = await sharp(t.edges.files.files.get(judgeKey)!).metadata();
    expect([judged.format, judged.width, judged.height]).toEqual(['png', 725, 1568]);

    const [row] = await receiptRows(number);
    expect(row!.sha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(row!.phash).toMatch(/^[0-9a-f]{16}$/);
    expect(row!.size).toBe(original.length);
  });

  it.each([
    ['a JPEG stays a JPEG', () => jpeg(), 'jpeg', 'jpg', 'jpeg', [725, 1568]],
    ['a WebP becomes PNG', () => webp(), 'webp', 'png', 'png', [725, 1568]],
    [
      'a PDF gives its first page as PNG',
      async () => receiptPdf({ pages: 3 }),
      'pdf',
      'png',
      'png',
      [1112, 1568],
    ],
    ['a tiny image is scaled up to 280 px', () => png(100, 150), 'png', 'png', 'png', [280, 420]],
    [
      'a very long strip is padded to 280 px',
      () => png(300, 4000),
      'png',
      'png',
      'png',
      [280, 1568],
    ],
  ] as const)('%s for the AI', async (_name, make, kind, ext, format, [width, height]) => {
    const s = await shopper();
    const number = await placeOrder(s);

    const res = await upload(s.token, number, await make());

    expect(res.status).toBe(201);
    const [row] = await receiptRows(number);
    expect(row!.kind).toBe(kind);
    expect(row!.normalizedKey).toMatch(new RegExp(`\\.judge\\.${ext}$`));
    const judged = await sharp(t.edges.files.files.get(row!.normalizedKey)!).metadata();
    expect([judged.format, judged.width, judged.height]).toEqual([format, width, height]);
  });

  it('renders the first page of a PDF, not a later one', async () => {
    const s = await shopper();
    const number = await placeOrder(s);

    // its later pages are landscape and dark: the wrong page shows in the size and the colour
    await upload(s.token, number, receiptPdf({ pages: 3 }));

    const [row] = await receiptRows(number);
    const judged = sharp(t.edges.files.files.get(row!.normalizedKey)!);
    const { width, height } = await judged.metadata();
    expect([width, height]).toEqual([1112, 1568]);
    // its top-left corner is page 1's white (a later page is dark from edge to edge)
    const corner = await judged
      .clone()
      .extract({ left: 0, top: 0, width: 8, height: 8 })
      .raw()
      .toBuffer();
    expect(new Set(corner)).toEqual(new Set([255]));
  });

  it('gives the same receipt, re-compressed, nearly the same perceptual hash', async () => {
    const a = await shopper(ali);
    const b = await shopper(vali, '998901112233');
    const first = await placeOrder(a);
    const second = await placeOrder(b);

    await upload(a.token, first, await png());
    await upload(
      b.token,
      second,
      await sharp(await png())
        .jpeg({ quality: 60 })
        .toBuffer(),
    );

    const [x] = await receiptRows(first);
    const [y] = await receiptRows(second);
    expect(x!.sha256).not.toBe(y!.sha256);
    expect(hamming(x!.phash, y!.phash)).toBeLessThanOrEqual(4);
  });
});

describe('a refused upload', () => {
  it.each([
    ['a GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')],
    [
      'a HEIC photo',
      Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic\0\0\0\0mif1heic')]),
    ],
    ['a text file', Buffer.from('Перевод 120 000 сум на карту 9860')],
    ['an empty body', Buffer.alloc(0)],
  ])('%s is not a receipt type: 415, nothing stored, the order still waits', async (_n, bytes) => {
    const s = await shopper();
    const number = await placeOrder(s);

    const res = await upload(s.token, number, bytes, 'chek.jpg');

    expect(res).toEqual({ status: 415, body: { code: 'unsupported_type' } });
    expect(storedKeys()).toEqual([]);
    expect(await receiptRows(number)).toEqual([]);
    expect(await statusOf(s, number)).toBe('awaiting_payment');
  });

  it.each([
    [
      'a PNG that breaks off',
      Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('not really an image')]),
    ],
    [
      'a PDF that does not open',
      Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >>\nnothing else'),
    ],
  ])('%s is unreadable: 422, nothing stored', async (_n, bytes) => {
    const s = await shopper();
    const number = await placeOrder(s);

    const res = await upload(s.token, number, bytes);

    expect(res).toEqual({ status: 422, body: { code: 'unreadable' } });
    expect(storedKeys()).toEqual([]);
    expect(await statusOf(s, number)).toBe('awaiting_payment');
  });

  it('over the size setting is too large: 413 with the limit, nothing stored', async () => {
    const owner = await t.ownerSession();
    const set = await owner.client.admin.settings.update({
      params: { key: 'receipts.maxUploadMb' },
      body: { value: 1 },
    });
    expect(set.status).toBe(200);
    const s = await shopper();
    const number = await placeOrder(s);
    const big = Buffer.concat([await png(), Buffer.alloc(1024 * 1024)]);

    const res = await upload(s.token, number, big);

    expect(res).toEqual({ status: 413, body: { code: 'too_large', maxBytes: 1024 * 1024 } });
    expect(storedKeys()).toEqual([]);
    expect(await statusOf(s, number)).toBe('awaiting_payment');
    // the same file under the default 10 MB goes in
    await owner.client.admin.settings.update({
      params: { key: 'receipts.maxUploadMb' },
      body: { value: 10 },
    });
    expect((await upload(s.token, number, big)).status).toBe(201);
  });

  it('above the upload ceiling is too large as well, not a bare error', async () => {
    const s = await shopper();
    const number = await placeOrder(s);

    const res = await upload(s.token, number, Buffer.alloc(22 * 1024 * 1024, 0xff));

    expect(res).toEqual({ status: 413, body: { code: 'too_large', maxBytes: 10 * 1024 * 1024 } });
    expect(storedKeys()).toEqual([]);
    expect(await statusOf(s, number)).toBe('awaiting_payment');
  });

  it('a PDF while every render slot is taken: 503 try_again, nothing stored; the same file goes in once one is free', async () => {
    const s = await shopper();
    const number = await placeOrder(s);
    const pdf = receiptPdf();
    // the other renders, still running
    const release: (() => void)[] = [];
    const running = Array.from({ length: pdfRenderSlots.limit }, () =>
      pdfRenderSlots.run(() => new Promise<void>((done) => release.push(done))),
    );

    try {
      expect(await upload(s.token, number, pdf)).toEqual({
        status: 503,
        body: { code: 'try_again' },
      });
      expect(storedKeys()).toEqual([]);
      expect(await statusOf(s, number)).toBe('awaiting_payment');
    } finally {
      release.forEach((done) => done());
      await Promise.all(running);
    }
    expect((await upload(s.token, number, pdf)).status).toBe(201);
  });
});

describe('several receipts per order', () => {
  it('refuses a second receipt while one is under check, and takes one again once the order is back in «Ожидает оплаты»', async () => {
    const s = await shopper();
    const number = await placeOrder(s);
    expect((await upload(s.token, number, await png(), 'first.png')).status).toBe(201);

    const again = await upload(s.token, number, await jpeg(), 'second.jpg');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'status_changed',
      order: { status: 'receipt_review' },
    });
    expect(storedKeys()).toHaveLength(2);

    await rejectReceipt(number);
    expect((await upload(s.token, number, await jpeg(), 'second.jpg')).status).toBe(201);

    const payment = await s.client.orders.payment({ params: { number } });
    expect(payment.status).toBe(200);
    if (payment.status !== 200) return;
    expect(payment.body.order.status).toBe('receipt_review');
    expect(payment.body.receipts.map((r) => r.fileName)).toEqual(['second.jpg', 'first.png']);
    expect(await receiptRows(number)).toHaveLength(2);
  });

  it('refuses a receipt for a cancelled order', async () => {
    const s = await shopper();
    const number = await placeOrder(s);
    expect(
      (
        await s.client.orders.cancel({
          params: { number },
          body: { expectedStatus: 'awaiting_payment' },
        })
      ).status,
    ).toBe(200);

    const res = await upload(s.token, number, await png());

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'status_changed', order: { status: 'cancelled' } });
    expect(storedKeys()).toEqual([]);
  });
});

describe('who may see a receipt', () => {
  it('nobody without a session: 401', async () => {
    const s = await shopper();
    const number = await placeOrder(s);
    expect((await upload(null, number, await png())).status).toBe(401);
    expect((await fetch(`${t.baseUrl}/orders/${number}/payment`)).status).toBe(401);
    expect((await fetchFile(`/orders/${number}/receipts/1/file`)).res.status).toBe(401);
    expect(storedKeys()).toEqual([]);
  });

  it('another shopper finds neither the order nor its receipt: 404, nothing stored', async () => {
    const a = await shopper(ali);
    const b = await shopper(vali, '998901112233');
    const number = await placeOrder(a);

    expect(await upload(b.token, number, await png())).toEqual({
      status: 404,
      body: { code: 'not_found' },
    });
    expect(storedKeys()).toEqual([]);
    expect(await statusOf(a, number)).toBe('awaiting_payment');

    await upload(a.token, number, await png());
    const [row] = await receiptRows(number);
    expect((await b.client.orders.payment({ params: { number } })).status).toBe(404);
    const theirs = await fetchFile(`/orders/${number}/receipts/${row!.id}/file`, {
      authorization: `Bearer ${b.token}`,
    });
    expect(theirs.res.status).toBe(404);
  });

  it('the shopper gets back their original, private and uncached; never through another order', async () => {
    const s = await shopper();
    const number = await placeOrder(s);
    const other = await placeOrder(s);
    const original = await png();
    await upload(s.token, number, original);
    const [row] = await receiptRows(number);
    const auth = { authorization: `Bearer ${s.token}` };

    const own = await fetchFile(`/orders/${number}/receipts/${row!.id}/file`, auth);
    expect(own.res.status).toBe(200);
    expect(own.bytes.equals(original)).toBe(true);
    expect(own.res.headers.get('content-type')).toBe('image/png');
    expect(own.res.headers.get('cache-control')).toBe('private, no-store');
    expect(own.res.headers.get('x-content-type-options')).toBe('nosniff');

    const wrong = await fetchFile(`/orders/${other}/receipts/${row!.id}/file`, auth);
    expect(wrong.res.status).toBe(404);
  });

  it('staff open the original or the AI image; a shopper session is not staff', async () => {
    const s = await shopper();
    const number = await placeOrder(s);
    const original = await receiptPdf();
    await upload(s.token, number, original);
    const [row] = await receiptRows(number);
    const manager = await t.managerSession();
    const path = `/admin/receipts/${row!.id}/file`;

    const pdf = await fetchFile(path, { cookie: manager.cookie });
    expect(pdf.res.status).toBe(200);
    expect(pdf.bytes.equals(original)).toBe(true);
    expect(pdf.res.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.res.headers.get('content-disposition')).toMatch(/^attachment;/);

    const judged = await fetchFile(`${path}?variant=normalized`, { cookie: manager.cookie });
    expect(judged.res.status).toBe(200);
    expect(judged.res.headers.get('content-type')).toBe('image/png');
    expect((await sharp(judged.bytes).metadata()).height).toBe(1568);

    expect((await fetchFile(path)).res.status).toBe(401);
    expect((await fetchFile(path, { authorization: `Bearer ${s.token}` })).res.status).toBe(401);
    expect(
      (await fetchFile(`/admin/receipts/999/file`, { cookie: manager.cookie })).res.status,
    ).toBe(404);
  });
});

describe('the shop card', () => {
  it("is the owner's alone: a manager gets 403", async () => {
    const manager = await t.managerSession();
    expect((await manager.client.admin.shopCard.get()).status).toBe(403);
    expect(
      (
        await manager.client.admin.shopCard.set({
          body: { number: '8600 1234 5678 9012', holder: 'X' },
        })
      ).status,
    ).toBe(403);
    expect((await manager.client.admin.shopCard.clear()).status).toBe(403);
  });

  it('the owner changes it; the shopper transfers to the new card; the audit keeps it masked', async () => {
    const owner = await t.ownerSession();

    const res = await owner.client.admin.shopCard.set({
      body: { number: '8600 1234-5678 9012', holder: '  OOO   LUMMI  ' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ card: { number: '8600123456789012', holder: 'OOO LUMMI' } });
    const s = await shopper();
    const number = await placeOrder(s);
    const payment = await s.client.orders.payment({ params: { number } });
    expect(payment.status === 200 && payment.body.card).toEqual({
      number: '8600123456789012',
      holder: 'OOO LUMMI',
    });
    const entries = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'shop_card.changed'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetType: 'shop_card',
      payload: {
        old: { number: '9860 •••• •••• 1234', holder: TEST_SHOP_CARD.holder },
        new: { number: '8600 •••• •••• 9012', holder: 'OOO LUMMI' },
      },
    });
    expect(JSON.stringify(entries)).not.toContain('8600123456789012');

    // the same card again changes nothing and writes nothing
    await owner.client.admin.shopCard.set({
      body: { number: '8600123456789012', holder: 'OOO LUMMI' },
    });
    expect(
      await t.db.select().from(auditLog).where(eq(auditLog.action, 'shop_card.changed')),
    ).toHaveLength(1);
  });

  it('removed while an order waits: a shopper who already paid still sends the receipt', async () => {
    const s = await shopper();
    const number = await placeOrder(s);
    const owner = await t.ownerSession();
    expect((await owner.client.admin.shopCard.clear()).status).toBe(200);

    const res = await upload(s.token, number, await png(), 'chek.png');

    expect(res.status).toBe(201);
    expect(await statusOf(s, number)).toBe('receipt_review');
    const payment = await s.client.orders.payment({ params: { number } });
    expect(payment.status === 200 && payment.body.card).toBeNull();
  });

  it('refuses a number that is not 16 digits', async () => {
    const owner = await t.ownerSession();
    for (const number of ['8600 1234 5678 901', '8600 1234 5678 90123', '8600 1234 5678 901x']) {
      const res = await owner.client.admin.shopCard.set({ body: { number, holder: 'OOO LUMMI' } });
      expect(res.status).toBe(400);
    }
    const now = await owner.client.admin.shopCard.get();
    expect(now.status === 200 && now.body.card?.number).toBe(TEST_SHOP_CARD.number);
  });

  it('without a card checkout is closed: «Оплата временно недоступна», no order, and no card on the payment screen', async () => {
    const s = await shopper();
    const waiting = await placeOrder(s);
    const owner = await t.ownerSession();

    const cleared = await owner.client.admin.shopCard.clear();
    expect(cleared).toMatchObject({ status: 200, body: { card: null } });

    const [f] = await t.db.select({ slug: fragrances.slug }).from(fragrances).limit(1);
    await s.client.cart.addLine({ body: { slug: f!.slug, ml: 10, qty: 1 } });
    const checkout = await s.client.checkout.get({ query: {} });
    expect(checkout.status === 200 && checkout.body.paymentAvailable).toBe(false);
    const body = await orderBody(s);
    const res = await s.client.orders.create({ body });
    expect(res).toMatchObject({ status: 503, body: { code: 'payment_unavailable' } });
    const list = await s.client.orders.list({ query: {} });
    expect(list.status === 200 && list.body.orders.map((o) => o.number)).toEqual([waiting]);
    const payment = await s.client.orders.payment({ params: { number: waiting } });
    expect(payment.status === 200 && payment.body.card).toBeNull();
    const entries = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'shop_card.cleared'));
    expect(entries[0]?.payload).toEqual({
      old: { number: '9860 •••• •••• 1234', holder: TEST_SHOP_CARD.holder },
    });

    // a card again opens checkout
    await owner.client.admin.shopCard.set({ body: TEST_SHOP_CARD });
    const again = await s.client.checkout.get({ query: {} });
    expect(again.status === 200 && again.body.paymentAvailable).toBe(true);
    expect((await s.client.orders.create({ body })).status).toBe(201);
  });
});
