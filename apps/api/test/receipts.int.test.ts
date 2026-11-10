import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import { and, asc, btsPoints, eq, fragrances, orders, outbox, regions } from '@lummi/db';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, type TestApp } from './harness/test-app';

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

/** The texts queued for the shopper (the outbox, ADR 0021), oldest first. */
const said = async () =>
  (await t.db.select().from(outbox).orderBy(asc(outbox.id))).map((r) => r.text);

const statusOf = async (number: number) =>
  (await t.db.select({ status: orders.status }).from(orders).where(eq(orders.number, number)))[0]!
    .status;

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
    expect(await statusOf(number)).toBe('receipt_review');

    expect(await said()).toContainEqual(expect.stringMatching(`^Чек к заказу № ${number} получен`));
  });
});

void vali;
void createHash;
