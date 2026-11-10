import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OrderStatus } from '@lummi/contracts';
import { discoverySet, eq, inArray, orderEvents, orders, volumes } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { OrderStatusService, type TransitionActor } from '../src/order-status/order-status.service';
import { orderBody, samarkandPoint, shopper, slugs as slugsOf, tenMl } from './harness/orders';
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
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 71, first_name: 'Ali', language_code: 'ru' };
const machine = () => t.app.get(OrderStatusService);
const staff = async (): Promise<TransitionActor> => ({
  type: 'staff',
  id: (await t.managerSession()).staff.id,
});

const discoveryOnHand = async () => (await t.db.select().from(discoverySet))[0]!.onHand;
const tenMlOnHand = async (slugs: string[]) =>
  Promise.all(
    slugs.map(async (s) => {
      const { id } = await tenMl(t, s);
      return (await t.db.select().from(volumes).where(eq(volumes.id, id)))[0]!.onHand;
    }),
  );

/** The same walk the status-machine tests use: every step a real `transition()`. */
async function walkTo(number: number, status: Exclude<OrderStatus, 'awaiting_payment'>) {
  const [order] = await t.db.select().from(orders).where(eq(orders.number, number));
  const { id, customerId } = order!;
  const manager = await staff();
  const path = [
    ['receipt_review', 'submit_receipt', { type: 'customer', id: customerId }, undefined],
    ['payment_confirmed', 'confirm_payment', { type: 'ai' }, undefined],
    ['accepted', 'accept', manager, undefined],
    ['assembling', 'start_assembly', manager, undefined],
    ['handed_to_bts', 'hand_to_bts', manager, { trackingNumber: 'BTS 4471 0098' }],
    ['delivered', 'deliver', manager, undefined],
  ] as const;
  let from: OrderStatus = 'awaiting_payment';
  for (const [to, action, actor, payload] of path) {
    const out = await machine().transition(id, action, actor, from, payload as never);
    if (out.kind !== 'done') throw new Error(`${action}: ${out.kind}`);
    if (to === status) return id;
    from = to;
  }
  throw new Error(`no path to ${status}`);
}

/** A Discovery set order (`discovery` boxes) and/or a builder order (`builder` sets) as a shopper. */
async function place(opts: { discovery?: number; builder?: { slugs: string[]; qty: number } }) {
  const client = await shopper(t, ali, '998901234567');
  const point = await samarkandPoint(t);
  if (opts.discovery) await client.cart.addDiscovery({ body: { qty: opts.discovery } });
  if (opts.builder) await client.cart.addBuilder({ body: opts.builder });
  const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({
    body: orderBody(point.id, checkout.body.quote.total),
  });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return { client, number: res.body.number };
}

const availableDiscovery = async (client: Awaited<ReturnType<typeof place>>['client']) => {
  const res = await client.sets.discovery();
  if (res.status !== 200) throw new Error('discovery');
  return res.body.available;
};

describe('on hand through the status machine: sets (ADR 0009, 0010)', () => {
  it('a Discovery handover lowers its own on hand, not the 10 ml; available stays put', async () => {
    await t.db.update(discoverySet).set({ onHand: 5 });
    const five = await slugsOf(t, 5);
    const before = await tenMlOnHand(five);
    const { client, number } = await place({ discovery: 2 });
    expect(await availableDiscovery(client)).toBe(3);

    const id = await walkTo(number, 'handed_to_bts');
    expect(await discoveryOnHand()).toBe(3);
    expect(await availableDiscovery(client)).toBe(3);
    expect(await tenMlOnHand(five)).toEqual(before);
    const [event] = (
      await t.db.select().from(orderEvents).where(eq(orderEvents.orderId, id))
    ).filter((e) => e.action === 'hand_to_bts');
    expect(event!.payload).toMatchObject({ onHand: [{ shelf: 'discovery_set', from: 5, to: 3 }] });
  });

  it('a builder handover lowers each of the five 10 ml by the set count', async () => {
    const five = await slugsOf(t, 5);
    await t.db
      .update(volumes)
      .set({ onHand: 6 })
      .where(inArray(volumes.id, await Promise.all(five.map(async (s) => (await tenMl(t, s)).id))));
    await t.db.update(discoverySet).set({ onHand: 4 });
    const { number } = await place({ builder: { slugs: five, qty: 2 } });
    expect(await tenMlOnHand(five)).toEqual([6, 6, 6, 6, 6]);

    await walkTo(number, 'handed_to_bts');
    expect(await tenMlOnHand(five)).toEqual([4, 4, 4, 4, 4]);
    expect(await discoveryOnHand()).toBe(4);
  });

  it('cancelling after handover puts both kinds back', async () => {
    const five = await slugsOf(t, 5);
    await t.db
      .update(volumes)
      .set({ onHand: 6 })
      .where(inArray(volumes.id, await Promise.all(five.map(async (s) => (await tenMl(t, s)).id))));
    await t.db.update(discoverySet).set({ onHand: 5 });
    const { number } = await place({ discovery: 2, builder: { slugs: five, qty: 1 } });
    const id = await walkTo(number, 'handed_to_bts');
    expect(await discoveryOnHand()).toBe(3);
    expect(await tenMlOnHand(five)).toEqual([5, 5, 5, 5, 5]);

    const out = await machine().transition(id, 'cancel', await staff(), 'handed_to_bts', {
      reason: 'not_collected_at_bts',
    });
    expect(out.kind).toBe('done');
    expect(await discoveryOnHand()).toBe(5);
    expect(await tenMlOnHand(five)).toEqual([6, 6, 6, 6, 6]);
  });

  it('a return with back-to-stock restores both lines', async () => {
    const five = await slugsOf(t, 5);
    await t.db
      .update(volumes)
      .set({ onHand: 6 })
      .where(inArray(volumes.id, await Promise.all(five.map(async (s) => (await tenMl(t, s)).id))));
    await t.db.update(discoverySet).set({ onHand: 5 });
    const { number } = await place({ discovery: 1, builder: { slugs: five, qty: 1 } });
    const id = await walkTo(number, 'delivered');
    expect(await discoveryOnHand()).toBe(4);
    expect(await tenMlOnHand(five)).toEqual([5, 5, 5, 5, 5]);

    const out = await machine().transition(id, 'return', await staff(), 'delivered', {
      reason: 'Не подошёл',
      lines: [
        { position: 0, backToStock: true },
        { position: 1, backToStock: true },
      ],
    });
    expect(out.kind).toBe('done');
    expect(await discoveryOnHand()).toBe(5);
    expect(await tenMlOnHand(five)).toEqual([6, 6, 6, 6, 6]);
  });
});
