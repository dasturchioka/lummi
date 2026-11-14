import { randomUUID } from 'node:crypto';
import {
  tashkentToUtc,
  type CancelReason,
  type CreateOrderBody,
  type FulfilBody,
  type OrderStatus,
} from '@lummi/contracts';
import { eq, orders, type OrderRow } from '@lummi/db';
import { ReceiptsService } from '../../src/receipts/receipts.service';
import { samarkandPoint, type shopper as signedUpShopper } from './orders';
import { payWithCredit, uniqueReceiptImage } from './payments';
import type { TestUser } from './sign-init-data';
import type { TestApp } from './test-app';

/*
 * An order's whole life through the real doors, for tests that need many orders at set times
 * (the reports' 20-order gate, #42): the shopper checks out, the money arrives and the receipt AI
 * confirms it (#32), managers walk it through the admin panel (#33), return it and record refunds
 * (#40). Every step happens at the fake clock's now.
 */

export type Shopper = Awaited<ReturnType<typeof signedUpShopper>>;

/** A Tashkent wall-clock time `YYYY-MM-DD HH:MM` as the UTC instant the fake clock takes. */
export function tashkent(at: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(at);
  const utc = m
    ? tashkentToUtc({ year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]! })
    : null;
  if (!utc) throw new Error(`not a Tashkent time: ${at}`);
  return utc;
}

/** A fresh shopper session at the clock's now (a session lasts an hour; fixtures jump days). */
export async function signedIn(t: TestApp, user: TestUser): Promise<Shopper> {
  return (await t.signIn(user)).client;
}

/** The cart as quoted now, ordered to a Samarkand point at the quoted total and discount. */
export async function placeOrder(t: TestApp, client: Shopper): Promise<OrderRow> {
  const point = await samarkandPoint(t);
  const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const body: CreateOrderBody = {
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998901234567',
    delivery: { kind: 'point', pointId: point.id },
    consent: true,
    confirmedTotal: checkout.body.quote.total,
    confirmedDiscount: checkout.body.quote.discount,
    idempotencyKey: randomUUID(),
  };
  const res = await client.orders.create({ body });
  if (res.status !== 201) throw new Error(`order ${res.status} ${JSON.stringify(res.body)}`);
  return orderRow(t, res.body.number);
}

export async function orderRow(t: TestApp, number: number): Promise<OrderRow> {
  const [o] = await t.db.select().from(orders).where(eq(orders.number, number));
  if (!o) throw new Error(`no order ${number}`);
  return o;
}

/** The shopper sends a receipt and a Credit of the amount due confirms it. */
export async function pay(t: TestApp, number: number): Promise<void> {
  const order = await orderRow(t, number);
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order.customerId, number, await uniqueReceiptImage(), {
      fileName: 'chek.png',
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`submit_receipt: ${sent.kind}`);
  await payWithCredit(t, order, sent.receipt.id);
}

const STEPS: [from: OrderStatus, FulfilBody][] = [
  ['payment_confirmed', { action: 'accept', expectedStatus: 'payment_confirmed' }],
  ['accepted', { action: 'start_assembly', expectedStatus: 'accepted' }],
  [
    'assembling',
    { action: 'hand_to_bts', expectedStatus: 'assembling', trackingNumber: 'BTS 4471 0098' },
  ],
  ['handed_to_bts', { action: 'deliver', expectedStatus: 'handed_to_bts' }],
];

/** A manager moves a paid order forward through the fulfilment steps until it reaches `status`. */
export async function fulfilTo(
  t: TestApp,
  number: number,
  status: 'accepted' | 'assembling' | 'handed_to_bts' | 'delivered',
): Promise<void> {
  const manager = await t.managerSession();
  let at = (await orderRow(t, number)).status;
  for (const [from, body] of STEPS) {
    if (at === status) return;
    if (at !== from) continue;
    const res = await manager.client.admin.orders.fulfil({ params: { number }, body });
    if (res.status !== 200) throw new Error(`${body.action} ${number}: ${res.status}`);
    at = res.body.order.status;
  }
  if (at !== status) throw new Error(`order ${number} is ${at}, not ${status}`);
}

/** A manager cancels the order from where it is, with a staff reason. */
export async function cancelByStaff(
  t: TestApp,
  number: number,
  reason: CancelReason = 'customer_refused',
): Promise<void> {
  const { status } = await orderRow(t, number);
  const manager = await t.managerSession();
  const res = await manager.client.admin.orders.cancel({
    params: { number },
    body: { expectedStatus: status, reason },
  });
  if (res.status !== 200) throw new Error(`cancel ${number}: ${res.status}`);
}

/** The whole delivered order came back (#40); nothing goes back on hand. */
export async function returnWhole(t: TestApp, number: number, reason: string): Promise<void> {
  const manager = await t.managerSession();
  const page = await manager.client.admin.orders.get({ params: { number } });
  if (page.status !== 200 || !page.body.returnPreview)
    throw new Error(`order page ${number}: ${page.status}`);
  const res = await manager.client.admin.orders.return({
    params: { number },
    body: {
      expectedStatus: 'delivered',
      reason,
      lines: page.body.returnPreview.lines.map((l) => ({
        position: l.position,
        backToStock: false,
      })),
    },
  });
  if (res.status !== 200) throw new Error(`return ${number}: ${res.status}`);
}

/** A manager records a Refund sent on `date` (a Tashkent day). */
export async function refund(
  t: TestApp,
  number: number,
  amount: number,
  date: string,
  reason = 'Вернули покупателю на карту',
): Promise<void> {
  const manager = await t.managerSession();
  const page = await manager.client.admin.orders.get({ params: { number } });
  if (page.status !== 200) throw new Error(`order page ${number}: ${page.status}`);
  const res = await manager.client.admin.orders.refund({
    params: { number },
    body: { amount, date, reason, expectedRefunded: page.body.money.refunded },
  });
  if (res.status !== 200)
    throw new Error(`refund ${number}: ${res.status} ${JSON.stringify(res.body)}`);
}
