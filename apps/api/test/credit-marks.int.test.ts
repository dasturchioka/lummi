import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, asc, auditLog, credits, eq, orders, receiptChecks, receipts } from '@lummi/db';
import pg from 'pg';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import type { ReceiptJudgeInput } from '../src/edges';
import { PaymentConfirmation } from '../src/payment/payment-confirmation';
import { PaymentMatching } from '../src/payment/payment-matching';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { placeOrder } from './harness/fulfilment';
import { shopper, slugs, untilWaitingOnLocks, whileLockedUntil } from './harness/orders';
import { payWithCredit, recordCredit, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): «Не для заказа» (#49). Staff mark an unlinked credit as money that is not for
 * an order (a personal transfer to the shop card): it is then never a Candidate credit, never
 * offered to link, and leaves the Home's «Поступления без заказа». Credits come in through the
 * userbot's endpoint, receipts through the intake, and the worker runs the checks on the test
 * Redis, as in production.
 */

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let checks: Queue;
beforeAll(async () => {
  t = await createTestApp();
  t.startWorker();
  checks = new Queue(t.env.RECEIPT_CHECKS_QUEUE, { connection: { url: t.env.REDIS_URL } });
});
afterAll(async () => {
  await checks.close();
  await t.close();
});
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-14T05:00:30Z'));
  t.edges.receiptJudge.calls.length = 0;
  t.edges.receiptJudge.respond = undefined;
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
});
// nothing of one test's matching may run into the next one's rows
afterEach(() => settled());

const ali: TestUser = { id: 4901, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 4902, first_name: 'Vali', language_code: 'uz' };
const MIN = 60_000;
const NOTE = 'Перевод от брата, не за заказ';

/** Every credit event handled and no receipt check queued or running. */
async function settled() {
  await vi.waitFor(
    async () => {
      const all = await t.db.select({ at: credits.eventHandledAt }).from(credits);
      expect(all.filter((r) => r.at === null)).toEqual([]);
      const counts = await checks.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
    },
    { timeout: 15_000, interval: 50 },
  );
}

let picked = 0;
/** One 10 ml bottle ordered by `user` at the clock's now; the order as stored. */
async function unpaidOrder(user: TestUser = ali, phone = '998901112233') {
  const client = await shopper(t, user, phone);
  const [slug] = (await slugs(t, 20)).slice(picked++ % 20);
  const add = await client.cart.addLine({ body: { slug: slug!, ml: 10, qty: 1 } });
  if (add.status !== 200) throw new Error(`add ${add.status}`);
  return placeOrder(t, client);
}

/** The shopper sends a receipt through the intake (#28): the order goes «Чек на проверке». */
async function sendReceipt(order: { customerId: number; number: number }) {
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order.customerId, order.number, await uniqueReceiptImage(), {
      fileName: 'chek.png',
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`submit_receipt: ${sent.kind}`);
  return sent.receipt.id;
}

const mark = (s: StaffSession, id: number, note?: string) =>
  s.client.admin.credits.markNotForOrder({
    params: { id },
    body: note === undefined ? {} : { note },
  });
const unmark = (s: StaffSession, id: number) =>
  s.client.admin.credits.unmarkNotForOrder({ params: { id } });

async function listed(s: StaffSession, linked: 'all' | 'unlinked' | 'linked' | 'not_for_order') {
  const res = await s.client.admin.credits.list({ query: { linked } });
  if (res.status !== 200) throw new Error(`credits ${res.status}`);
  return res.body;
}

const creditAudit = (id: number) =>
  t.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetType, 'credit'), eq(auditLog.targetId, String(id))))
    .orderBy(asc(auditLog.id));

describe('marking a credit «Не для заказа»', () => {
  it('owner and manager mark and unmark; each is in the audit with the actor; the list shows who, when and the note', async () => {
    const creditId = await recordCredit(t, { som: 150_000 });
    const manager = await t.managerSession();
    t.edges.clock.advance(3 * MIN);

    const res = await mark(manager, creditId, `  ${NOTE}  `);
    expect(res.status).toBe(200);
    const marked = {
      at: '2026-11-14T05:03:30.000Z',
      by: { id: manager.staff.id, name: 'Manager' },
      note: NOTE,
    };
    expect(res.status === 200 && res.body).toMatchObject({ id: creditId, notForOrder: marked });

    // the list: no longer «Не привязано»; the marked filter has it with who, when and the note
    expect((await listed(manager, 'unlinked')).total).toBe(0);
    const only = await listed(manager, 'not_for_order');
    expect(only.items.map((c) => [c.id, c.order, c.notForOrder])).toEqual([
      [creditId, null, marked],
    ]);
    expect((await listed(manager, 'all')).items[0]!.notForOrder).toEqual(marked);
    expect((await listed(manager, 'linked')).total).toBe(0);

    const owner = await t.ownerSession();
    t.edges.clock.advance(MIN);
    const back = await unmark(owner, creditId);
    expect(back.status).toBe(200);
    expect(back.status === 200 && back.body.notForOrder).toBeNull();
    expect((await listed(owner, 'unlinked')).items.map((c) => c.id)).toEqual([creditId]);
    expect((await listed(owner, 'not_for_order')).total).toBe(0);

    expect(
      (await creditAudit(creditId)).map((a) => [a.action, a.actorType, a.actorId, a.payload]),
    ).toEqual([
      [
        'credit.marked_not_for_order',
        'staff',
        manager.staff.id,
        expect.objectContaining({ note: NOTE, amountTiyin: 15_000_000 }),
      ],
      [
        'credit.unmarked_not_for_order',
        'staff',
        owner.staff.id,
        expect.objectContaining({ note: NOTE, markedBy: manager.staff.id }),
      ],
    ]);
  });

  it('a note is optional; an empty one is none', async () => {
    const a = await recordCredit(t, { som: 10_000 });
    const b = await recordCredit(t, { som: 20_000 });
    const manager = await t.managerSession();
    const first = await mark(manager, a);
    expect(first.status === 200 && first.body.notForOrder?.note).toBeNull();
    const second = await mark(manager, b, '   ');
    expect(second.status === 200 && second.body.notForOrder?.note).toBeNull();
  });

  it('the note is held to the setting, counted as a person counts: an emoji is one', async () => {
    const creditId = await recordCredit(t, { som: 10_000 });
    const owner = await t.ownerSession();
    expect((await owner.client.admin.credits.list({ query: {} })).body).toMatchObject({
      limits: { markNoteMax: 500 },
    });
    await owner.client.admin.settings.update({
      params: { key: 'payments.creditMarkNoteMaxLength' },
      body: { value: 20 },
    });
    const long = await mark(owner, creditId, 'я'.repeat(21));
    expect(long.status).toBe(422);
    expect(long.body).toEqual({ code: 'note_too_long', max: 20 });
    expect((await listed(owner, 'unlinked')).total).toBe(1);
    expect(await creditAudit(creditId)).toEqual([]);
    // twenty characters (forty UTF-16 units) fit
    expect((await mark(owner, creditId, '🙂'.repeat(20))).status).toBe(200);
  });

  it('a linked credit is never marked: 409 credit_taken with the credit as it is', async () => {
    const order = await unpaidOrder();
    const receiptId = await sendReceipt(order);
    t.edges.clock.advance(2 * MIN);
    const creditId = await payWithCredit(t, order, receiptId);
    const manager = await t.managerSession();
    const res = await mark(manager, creditId, NOTE);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'credit_taken',
      credit: { id: creditId, order: { number: order.number }, notForOrder: null },
    });
    expect(await creditAudit(creditId)).toEqual([]);
  });

  it('a stale screen: marking a marked credit, or unmarking one that is not, is 409 credit_changed and writes nothing', async () => {
    const creditId = await recordCredit(t, { som: 10_000 });
    const manager = await t.managerSession();
    expect((await unmark(manager, creditId)).body).toMatchObject({
      code: 'credit_changed',
      credit: { id: creditId, notForOrder: null },
    });
    expect((await mark(manager, creditId, 'первый')).status).toBe(200);
    const again = await mark(manager, creditId, 'второй');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'credit_changed',
      credit: { notForOrder: { note: 'первый' } },
    });
    expect((await creditAudit(creditId)).map((a) => a.action)).toEqual([
      'credit.marked_not_for_order',
    ]);
  });

  it('an unknown credit is 404; an id past the safe integers is 400', async () => {
    const manager = await t.managerSession();
    expect((await mark(manager, 999)).status).toBe(404);
    expect((await unmark(manager, 999)).status).toBe(404);
    for (const method of ['POST', 'DELETE']) {
      const res = await fetch(`${t.baseUrl}/admin/credits/100000000000000000000/not-for-order`, {
        method,
        headers: { cookie: manager.cookie, 'content-type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      expect(res.status, method).toBe(400);
    }
  });

  it('a shopper session, or none, is refused', async () => {
    const creditId = await recordCredit(t, { som: 10_000 });
    const { token } = await t.signIn(ali);
    for (const headers of [{ authorization: `Bearer ${token}` }, {}])
      for (const method of ['POST', 'DELETE']) {
        const res = await fetch(`${t.baseUrl}/admin/credits/${creditId}/not-for-order`, {
          method,
          headers: { ...headers, 'content-type': 'application/json' },
          body: method === 'POST' ? '{}' : undefined,
        });
        expect(res.status, method).toBe(401);
      }
    const [credit] = await t.db.select().from(credits).where(eq(credits.id, creditId));
    expect(credit!.notForOrderAt).toBeNull();
  });
});

/** The judge confirms the latest candidate it is shown (the shopper's own transfer). */
const pickLatest = (input: ReceiptJudgeInput) => ({
  isReceipt: 0.97,
  amountMatches: 0.95,
  recipientMatches: 0.93,
  chosenCreditId: input.candidates.at(-1)!.creditId,
  choiceConfidence: 0.81,
  confirmed: true,
  provider: 'typesafe' as const,
});

/** A promise and its resolver: holds the judge mid-answer until the test lets it go. */
function hold() {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  return { held, release };
}

describe('a marked credit pays no order', () => {
  it('a receipt waiting with only a marked credit never gets it; unmarking offers it to matching again', async () => {
    const order = await unpaidOrder();
    t.edges.receiptJudge.respond = pickLatest;
    // the credit arrives first and is marked before the receipt comes
    t.edges.clock.advance(2 * MIN);
    const creditId = await recordCredit(t, { som: order.amountDue });
    await settled();
    const manager = await t.managerSession();
    expect((await mark(manager, creditId, NOTE)).status).toBe(200);
    t.edges.clock.advance(MIN);
    const receiptId = await sendReceipt(order);
    await settled();
    // the sweep finds nothing to ask either
    expect(await t.app.get(PaymentMatching).queueChecks()).toEqual([]);
    expect(t.edges.receiptJudge.calls).toEqual([]);
    const [waiting] = await t.db.select().from(receipts).where(eq(receipts.id, receiptId));
    expect(waiting!.verdict).toBe('pending');
    // nor is it the order's Candidate credit when staff link by hand
    const options = await manager.client.admin.orders.creditOptions({
      params: { number: order.number },
    });
    expect(options.status === 200 && [options.body.candidates, options.body.others]).toEqual([
      [],
      [],
    ]);

    // «Вернуть в поступления»: the credit goes back to matching at once, the AI pays the order
    expect((await unmark(manager, creditId)).status).toBe(200);
    await vi.waitFor(
      async () => {
        const [o] = await t.db.select().from(orders).where(eq(orders.id, order.id));
        expect([o!.status, o!.creditId]).toEqual(['payment_confirmed', creditId]);
      },
      { timeout: 15_000 },
    );
    expect(t.edges.receiptJudge.calls.map((c) => c.candidates.map((x) => x.creditId))).toEqual([
      [creditId],
    ]);
  });

  it('the door refuses a marked credit for staff and for the AI: credit_taken, nothing changes', async () => {
    const order = await unpaidOrder();
    t.edges.clock.advance(2 * MIN);
    const creditId = await recordCredit(t, { som: order.amountDue });
    const manager = await t.managerSession();
    expect((await mark(manager, creditId)).status).toBe(200);

    const res = await manager.client.admin.orders.confirmPayment({
      params: { number: order.number },
      body: { creditId, receiptId: null },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'credit_taken',
      order: { order: { status: 'awaiting_payment' } },
    });

    const receiptId = await sendReceipt(order);
    const ai = await t.app.get(PaymentConfirmation).confirmPayment({
      orderId: order.id,
      creditId,
      receiptId,
      actor: { type: 'ai' },
    });
    expect(ai).toEqual({ kind: 'credit_taken', orderId: null });
    const [o] = await t.db.select().from(orders).where(eq(orders.id, order.id));
    expect([o!.status, o!.creditId]).toEqual(['receipt_review', null]);
  });

  it('a credit marked while the AI answers: the AI is refused and the receipt goes to a person (credit_marked), never left waiting', async () => {
    const order = await unpaidOrder();
    const receiptId = await sendReceipt(order);
    const answering = hold();
    t.edges.receiptJudge.respond = async (input) => {
      await answering.held;
      return pickLatest(input);
    };
    t.edges.clock.advance(2 * MIN);
    const creditId = await recordCredit(t, { som: order.amountDue });
    // the judge has the credit in front of it and is answering
    await vi.waitFor(() => expect(t.edges.receiptJudge.calls).toHaveLength(1), {
      timeout: 15_000,
    });
    const manager = await t.managerSession();
    expect((await mark(manager, creditId, NOTE)).status).toBe(200);

    answering.release();
    await vi.waitFor(
      async () => {
        const [r] = await t.db.select().from(receipts).where(eq(receipts.id, receiptId));
        expect([r!.verdict, r!.reviewReason]).toEqual(['manual_review', 'credit_marked']);
      },
      { timeout: 15_000 },
    );
    const [o] = await t.db.select().from(orders).where(eq(orders.id, order.id));
    expect([o!.status, o!.creditId]).toEqual(['receipt_review', null]);
    const checks = await t.db
      .select()
      .from(receiptChecks)
      .where(eq(receiptChecks.receiptId, receiptId));
    expect(checks.map((c) => c.outcome)).toEqual(['credit_taken']);

    // a person sees it: the Home's held receipts and the order page say why
    const home = await manager.client.admin.home();
    expect(home.status === 200 && home.body.queues.receipts.count).toBe(1);
    expect(home.status === 200 && home.body.now).toMatchObject({
      kind: 'receipt',
      number: order.number,
      reviewReason: 'credit_marked',
    });
    const page = await manager.client.admin.orders.get({ params: { number: order.number } });
    expect(page.status === 200 && page.body.payment).toBe('manual_review');
    expect(page.status === 200 && page.body.receipts[0]).toMatchObject({
      id: receiptId,
      reviewReason: 'credit_marked',
      checks: [{ outcome: 'credit_taken' }],
    });
  });

  it('the mark takes the credit first: the link that comes after is refused with credit_taken', async () => {
    const order = await unpaidOrder();
    t.edges.clock.advance(2 * MIN);
    const creditId = await recordCredit(t, { som: order.amountDue });
    const manager = await t.managerSession();
    // hold the order's row: the link waits at its first lock, before the credit's
    const locker = new pg.Client({ connectionString: t.env.DATABASE_URL });
    await locker.connect();
    try {
      await locker.query('begin');
      await locker.query('select id from orders where id = $1 for update', [order.id]);
      const link = manager.client.admin.orders.confirmPayment({
        params: { number: order.number },
        body: { creditId, receiptId: null },
      });
      await untilWaitingOnLocks(locker, 1);
      // the mark takes the credit's lock and commits while the link waits
      expect((await mark(manager, creditId, NOTE)).status).toBe(200);
      await locker.query('commit');
      const refused = await link;
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: 'credit_taken',
        order: { order: { status: 'awaiting_payment' } },
      });
    } finally {
      await locker.end();
    }
    const [credit] = await t.db.select().from(credits).where(eq(credits.id, creditId));
    expect(credit!.notForOrderAt).not.toBeNull();
    const [o] = await t.db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.creditId).toBeNull();
  });

  it('mark and link at once: exactly one wins, the other hears 409 credit_taken', async () => {
    for (let round = 0; round < 4; round++) {
      const order = await unpaidOrder(round % 2 ? vali : ali, `99890111223${round}`);
      t.edges.clock.advance(2 * MIN);
      const creditId = await recordCredit(t, { som: order.amountDue });
      const one = await t.managerSession();
      const two = await t.ownerSession();
      // both reach the credit's row lock before either may take it
      const [linkRes, markRes] = await whileLockedUntil(t, 'credits', 2, () =>
        Promise.all([
          one.client.admin.orders.confirmPayment({
            params: { number: order.number },
            body: { creditId, receiptId: null },
          }),
          mark(two, creditId, NOTE),
        ]),
      );
      expect([linkRes.status, markRes.status].sort()).toEqual([200, 409]);
      const loser = linkRes.status === 409 ? linkRes : markRes;
      expect(loser.body).toMatchObject({ code: 'credit_taken' });
      const [credit] = await t.db.select().from(credits).where(eq(credits.id, creditId));
      const [o] = await t.db.select().from(orders).where(eq(orders.id, order.id));
      // never both: linked and unmarked, or marked and unlinked
      expect(o!.creditId === creditId).toBe(credit!.notForOrderAt === null);
    }
  });
});

describe('the Home queue «Поступления без заказа»', () => {
  it('leaves linked and marked credits out; its count equals the filtered credits list', async () => {
    const a = await recordCredit(t, { som: 10_000, at: new Date('2026-11-14T04:10:00Z') });
    const b = await recordCredit(t, { som: 20_000, at: new Date('2026-11-14T04:20:00Z') });
    await recordCredit(t, { som: 30_000, at: new Date('2026-11-14T04:30:00Z') });
    const manager = await t.managerSession();
    const home = async () => {
      const res = await manager.client.admin.home();
      if (res.status !== 200) throw new Error(`home ${res.status}`);
      return res.body;
    };
    expect((await home()).queues.credits.count).toBe(3);

    // the oldest is a personal transfer: the queue moves on to the next one
    expect((await mark(manager, a)).status).toBe(200);
    const after = await home();
    expect(after.queues.credits).toMatchObject({
      count: 2,
      since: { day: '2026-11-14', time: '09:20' },
      oldestAmountTiyin: 2_000_000,
    });
    expect(after.now).toMatchObject({ kind: 'credit', id: b });
    expect((await listed(manager, 'unlinked')).total).toBe(after.queues.credits.count);

    expect((await mark(manager, b)).status).toBe(200);
    // a credit that paid an order is not in the queue either
    const paid = await unpaidOrder();
    t.edges.clock.advance(MIN);
    await payWithCredit(t, paid, await sendReceipt(paid));
    expect((await listed(manager, 'linked')).total).toBe(1);
    const last = await home();
    expect(last.queues.credits.count).toBe(1);
    expect((await listed(manager, 'unlinked')).total).toBe(1);
    expect((await listed(manager, 'not_for_order')).total).toBe(2);
    expect((await listed(manager, 'all')).total).toBe(4);
  });
});
