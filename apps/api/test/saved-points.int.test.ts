import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, btsPoints, eq, ne, regions, settings } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { orderBody, samarkandPoint, shopper, slugs as slugsOf } from './harness/orders';
import { createTestApp, type TestApp } from './harness/test-app';
import type { TestUser } from './harness/sign-init-data';

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
  t.edges.clock.set(new Date('2026-11-11T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 91, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 92, first_name: 'Vali', language_code: 'uz' };

type Client = Awaited<ReturnType<typeof shopper>>;

/** Active points of Samarkand, after the first one. */
async function otherPoints(n: number) {
  const first = await samarkandPoint(t);
  return t.db
    .select()
    .from(btsPoints)
    .where(
      and(
        eq(btsPoints.regionId, first.regionId),
        eq(btsPoints.active, true),
        ne(btsPoints.id, first.id),
      ),
    )
    .limit(n);
}

/** Buys one 10 ml «Купить сейчас» (the cart plays no part) for this recipient at this point. */
async function buy(
  client: Client,
  pointId: number,
  recipient: { name?: string; phone?: string } = {},
) {
  const [s] = await slugsOf(t, 1);
  const res = await client.orders.create({
    body: {
      ...orderBody(pointId, 94_000),
      item: `volume:${s}:10`,
      ...(recipient.name ? { recipientName: recipient.name } : {}),
      ...(recipient.phone ? { recipientPhone: recipient.phone } : {}),
    },
  });
  if (res.status !== 201) throw new Error(`order: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function saved(client: Client) {
  const res = await client.me.savedPoints();
  if (res.status !== 200) throw new Error(`saved: ${res.status}`);
  return res.body;
}

const later = (minutes: number) =>
  t.edges.clock.set(new Date(t.edges.clock.now().getTime() + minutes * 60_000));

describe('«Мои пункты BTS» (spec Changes 2026-11-07, BTS point selection)', () => {
  it('saves the recipient and point of an order, and checkout offers them first', async () => {
    const client = await shopper(t, ali, '998901234567');
    const p = await samarkandPoint(t);
    expect(await saved(client)).toEqual([]);
    await buy(client, p.id, { name: 'Dilnoza Karimova', phone: '90 765 43 21' });
    const list = await saved(client);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      recipientName: 'Dilnoza Karimova',
      recipientPhone: '+998907654321',
      point: { id: p.id, code: p.code, name: p.name },
      region: { id: p.regionId },
      hidden: false,
    });
    const checkout = await client.checkout.get({ query: {} });
    expect(checkout.status === 200 && checkout.body.savedPoints.map((s) => s.id)).toEqual([
      list[0]!.id,
    ]);
    expect(checkout.status === 200 && checkout.body.defaultSavedPointId).toBe(list[0]!.id);
  });

  it('one entry per recipient phone + point, the last used first', async () => {
    const client = await shopper(t, ali, '998901234567');
    const p = await samarkandPoint(t);
    const [q] = await otherPoints(1);
    await buy(client, p.id, { name: 'Ali', phone: '+998 90 123 45 67' });
    later(1);
    await buy(client, q!.id, { name: 'Ali', phone: '+998 90 123 45 67' });
    later(1);
    // the same phone typed another way, a new name: the same entry, renamed and used last
    await buy(client, p.id, { name: 'Ali Valiyev', phone: '901234567' });
    later(1);
    // another recipient at the same point is an entry of its own
    await buy(client, q!.id, { name: 'Vali', phone: '+998 93 000 00 00' });
    const list = await saved(client);
    expect(list.map((s) => [s.point.id, s.recipientPhone, s.recipientName])).toEqual([
      [q!.id, '+998930000000', 'Vali'],
      [p.id, '+998901234567', 'Ali Valiyev'],
      [q!.id, '+998901234567', 'Ali'],
    ]);
  });

  it('a typed address is not saved; another customer never sees mine', async () => {
    const client = await shopper(t, ali, '998901234567');
    const other = await shopper(t, vali, '998907654321');
    const p = await samarkandPoint(t);
    const [s] = await slugsOf(t, 1);
    const typed = await client.orders.create({
      body: {
        ...orderBody(p.id, 94_000),
        item: `volume:${s}:10`,
        delivery: {
          kind: 'typed',
          regionId: p.regionId,
          text: 'Самарканд, ул. Регистан 1, у фонтана',
        },
      },
    });
    expect(typed.status).toBe(201);
    expect(await saved(client)).toEqual([]);
    await buy(client, p.id);
    expect(await saved(client)).toHaveLength(1);
    expect(await saved(other)).toEqual([]);
  });

  it('removing one never touches the order it came from', async () => {
    const client = await shopper(t, ali, '998901234567');
    const other = await shopper(t, vali, '998907654321');
    const p = await samarkandPoint(t);
    const made = await buy(client, p.id, { name: 'Dilnoza', phone: '907654321' });
    const [entry] = await saved(client);
    expect((await other.me.removeSavedPoint({ params: { id: entry!.id } })).status).toBe(404);
    const res = await client.me.removeSavedPoint({ params: { id: entry!.id } });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body).toEqual([]);
    const o = await client.orders.get({ params: { number: made.number } });
    expect(o.status === 200 && [o.body.recipient, o.body.delivery.point?.code]).toEqual([
      { name: 'Dilnoza', phone: '+998907654321' },
      p.code,
    ]);
  });

  it('a point BTS hid since is flagged and never the default', async () => {
    const client = await shopper(t, ali, '998901234567');
    const p = await samarkandPoint(t);
    const [q] = await otherPoints(1);
    await buy(client, q!.id);
    later(1);
    await buy(client, p.id);
    await t.db.update(btsPoints).set({ active: false }).where(eq(btsPoints.id, p.id));
    const checkout = await client.checkout.get({ query: {} });
    if (checkout.status !== 200) throw new Error('checkout');
    expect(checkout.body.savedPoints.map((s) => [s.point.id, s.hidden])).toEqual([
      [p.id, true],
      [q!.id, false],
    ]);
    expect(checkout.body.defaultSavedPointId).toBe(checkout.body.savedPoints[1]!.id);
    // with only hidden ones there is no default
    await t.db.update(btsPoints).set({ active: false }).where(eq(btsPoints.id, q!.id));
    const none = await client.checkout.get({ query: {} });
    expect(none.status === 200 && none.body.defaultSavedPointId).toBeNull();
  });

  it('keeps at most `delivery.savedPointsMax`, dropping the least recently used', async () => {
    await t.db
      .insert(settings)
      .values({ key: 'delivery.savedPointsMax', value: 2 })
      .onConflictDoUpdate({ target: settings.key, set: { value: 2 } });
    const client = await shopper(t, ali, '998901234567');
    const p = await samarkandPoint(t);
    const [q, r] = await otherPoints(2);
    await buy(client, p.id);
    later(1);
    await buy(client, q!.id);
    later(1);
    await buy(client, r!.id);
    expect((await saved(client)).map((s) => s.point.id)).toEqual([r!.id, q!.id]);
    expect((await t.db.select().from(regions)).length).toBe(14);
  });
});
