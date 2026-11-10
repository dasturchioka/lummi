import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  and,
  asc,
  auditLog,
  btsPoints,
  eq,
  fragrances,
  orderEvents,
  orders,
  outbox,
  regions,
  volumes,
} from '@lummi/db';
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
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };
const HOUR = 3600_000;

/** A shopper with a shared phone, signed in. */
async function shopper(user: TestUser = ali, phone = '998901234567') {
  const { client } = await t.signIn(user);
  const proof = signContact({
    botToken: TEST_BOT_TOKEN,
    userId: user.id,
    phone,
    authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
  });
  if ((await client.me.shareContact({ body: { proof } })).status !== 200)
    throw new Error('contact');
  return client;
}
type Client = Awaited<ReturnType<typeof shopper>>;

async function firstSlug() {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows.map((r) => r.slug).sort()[0]!;
}

async function volumeOf(slug: string, ml: number) {
  const [v] = await t.db
    .select({ id: volumes.id, onHand: volumes.onHand })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, ml)));
  return v!;
}

/** What a shopper sees as available for that volume on the fragrance card. */
async function available(client: Client, slug: string, ml: number) {
  const card = await client.catalog.fragrance({ params: { slug } });
  if (card.status !== 200) throw new Error(`card ${card.status}`);
  return card.body.volumes.find((v) => v.ml === ml)!.available;
}

/** Places an order for `qty` of the slug's 10 ml at the quoted total; returns its number. */
async function placeOrder(client: Client, slug: string, qty = 1) {
  const add = await client.cart.addLine({ body: { slug, ml: 10, qty } });
  if (add.status !== 200) throw new Error(`add ${add.status}`);
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  const checkout = await client.checkout.get({ query: { regionId: region!.id } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({
    body: {
      recipientName: 'Ali Valiyev',
      recipientPhone: '+998901234567',
      delivery: { kind: 'point', pointId: point!.id },
      consent: true,
      confirmedTotal: checkout.body.quote.total,
      idempotencyKey: randomUUID(),
    },
  });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return res.body.number;
}

async function orderRow(number: number) {
  const [o] = await t.db.select().from(orders).where(eq(orders.number, number));
  return o!;
}
async function eventsOf(number: number) {
  const o = await orderRow(number);
  return t.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, o.id))
    .orderBy(asc(orderEvents.id));
}
/** Outbox rows other than the "order created" message. */
async function messages() {
  const rows = await t.db.select().from(outbox).orderBy(asc(outbox.id));
  return rows.filter((r) => !/оформлен|rasmiylashtirildi/.test(r.text));
}

describe('the shopper cancels their own order', () => {
  it('while «Ожидает оплаты»: the reserve frees at once, with the event, the audit and the message', async () => {
    const slug = await firstSlug();
    const client = await shopper();
    await t.db
      .update(volumes)
      .set({ onHand: 3 })
      .where(eq(volumes.id, (await volumeOf(slug, 10)).id));
    const number = await placeOrder(client, slug, 2);
    expect(await available(client, slug, 10)).toBe(1);
    t.edges.clock.advance(HOUR / 2);

    const res = await client.orders.cancel({
      params: { number },
      body: { expectedStatus: 'awaiting_payment' },
    });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body).toMatchObject({
      number,
      status: 'cancelled',
      cancellation: { reason: 'customer_cancelled', at: '2026-11-09T10:30:00.000Z' },
    });
    // the reserve is gone at once; on hand never moved (nothing left the warehouse)
    expect(await available(client, slug, 10)).toBe(3);
    expect((await volumeOf(slug, 10)).onHand).toBe(3);

    const [event] = await eventsOf(number);
    expect(event).toMatchObject({
      fromStatus: 'awaiting_payment',
      toStatus: 'cancelled',
      action: 'cancel',
      actorType: 'customer',
      reason: 'customer_cancelled',
      createdAt: new Date('2026-11-09T10:30:00Z'),
    });
    expect(event!.actorId).not.toBeNull();
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, 'order.cancelled'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: 'customer',
      actorId: event!.actorId,
      targetType: 'order',
      payload: { number, from: 'awaiting_payment', to: 'cancelled', reason: 'customer_cancelled' },
    });

    const [message] = await messages();
    expect(message).toMatchObject({
      chatId: ali.id,
      text: `Заказ № ${number} отменён.\nВы отменили заказ.`,
      options: {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Открыть заказ',
                web_app: { url: `https://miniapp.test.invalid/orders/${number}` },
              },
            ],
          ],
        },
      },
    });
  });
});
