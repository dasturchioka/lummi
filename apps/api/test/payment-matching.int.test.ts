import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asc,
  credits,
  eq,
  fragrances,
  orderEvents,
  orders,
  outbox,
  receiptChecks,
  receipts,
  shopCard,
} from '@lummi/db';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import type { ReceiptJudgeInput, ReceiptJudgement } from '../src/edges';
import { CreditEvents } from '../src/humo/credit-events';
import { PaymentConfirmation } from '../src/payment/payment-confirmation';
import { PaymentMatching } from '../src/payment/payment-matching';
import type { WorkerRuntime } from '../src/worker/runtime';
import { orderBody, samarkandPoint, shopper } from './harness/orders';
import { recordCredit, SHOP_LAST4, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_SHOP_CARD, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028) with the judge fake: automatic payment matching (ADR 0012, 0013). Receipts go
 * in over HTTP, credits through the userbot's internal endpoint, and the worker runs the "credit
 * recorded" event and the receipt checks on the test Redis, as in production.
 */

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let worker: WorkerRuntime;
let checks: Queue;
beforeAll(async () => {
  t = await createTestApp();
  worker = t.startWorker();
  checks = new Queue(t.env.RECEIPT_CHECKS_QUEUE, { connection: { url: t.env.REDIS_URL } });
});
afterAll(async () => {
  await checks.close();
  await t.close();
});
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:30Z'));
  t.edges.receiptJudge.calls.length = 0;
  t.edges.receiptJudge.respond = undefined;
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});
// nothing of one test's matching may run into the next one's rows
afterEach(() => settled());

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };

/** One 10 ml bottle ordered by a shopper; the order as stored and the shopper's session. */
async function placeOrder(user: TestUser = ali, phone = '998901234567') {
  const { token } = await t.signIn(user);
  const client = await shopper(t, user, phone);
  const [f] = await t.db.select({ slug: fragrances.slug }).from(fragrances).limit(1);
  if ((await client.cart.addLine({ body: { slug: f!.slug, ml: 10, qty: 1 } })).status !== 200)
    throw new Error('add');
  const point = await samarkandPoint(t);
  const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  const [order] = await t.db.select().from(orders).where(eq(orders.number, res.body.number));
  return { order: order!, client, token };
}
type Placed = Awaited<ReturnType<typeof placeOrder>>;

/** `POST /orders/:number/receipts` as the Mini App sends it (a fresh screenshot unless `file`); the new receipt's id. */
async function upload(p: Placed, file?: Buffer): Promise<number> {
  const res = await fetch(`${t.baseUrl}/orders/${p.order.number}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${p.token}` },
    body: file ?? (await uniqueReceiptImage()),
  });
  if (res.status !== 201) throw new Error(`upload ${res.status}`);
  return ((await res.json()) as { receipt: { id: number } }).receipt.id;
}

/** The order's status as its shopper reads it. */
async function statusOf(p: Placed) {
  const res = await p.client.orders.get({ params: { number: p.order.number } });
  if (res.status !== 200) throw new Error(`order ${res.status}`);
  return res.body.status;
}

const receiptNow = async (id: number) =>
  (await t.db.select().from(receipts).where(eq(receipts.id, id)))[0]!;
const orderNow = async (id: number) =>
  (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
const said = async () =>
  (await t.db.select().from(outbox).orderBy(asc(outbox.id))).map((r) => r.text);

/** Every credit event handled and no receipt check queued or running. */
async function settled() {
  await vi.waitFor(
    async () => {
      const pending = await t.db.select({ id: credits.id }).from(credits);
      const handled = await t.db
        .select({ at: credits.eventHandledAt })
        .from(credits)
        .then((rows) => rows.filter((r) => r.at !== null));
      expect(handled).toHaveLength(pending.length);
      const counts = await checks.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
    },
    { timeout: 15_000, interval: 50 },
  );
}

/** The judge's answer when every question clears the thresholds and it picks `creditId`. */
const confirmedChoosing = (creditId: number): ReceiptJudgement => ({
  isReceipt: 0.97,
  amountMatches: 0.95,
  recipientMatches: 0.93,
  chosenCreditId: creditId,
  choiceConfidence: 0.81,
  confirmed: true,
  provider: 'typesafe',
});

/** The judge's answer when the receipt shows none of the candidates' times. */
const noneOfThese: ReceiptJudgement = {
  isReceipt: 0.97,
  amountMatches: 0.95,
  recipientMatches: 0.93,
  chosenCreditId: null,
  choiceConfidence: 0.9,
  confirmed: false,
  provider: 'typesafe',
  reason: 'typesafe: below threshold',
};

/** A promise and its resolver: holds the judge mid-answer until the test lets it go. */
function hold() {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  return { held, release };
}

const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

/** A judge that confirms the latest candidate it is shown (the shopper's own transfer). */
const pickLatest = (input: ReceiptJudgeInput) =>
  confirmedChoosing(input.candidates.at(-1)!.creditId);

describe('a waiting receipt and the credit that pays it', () => {
  it('the credit arrives after the receipt: one AI call, the order is paid by the AI', async () => {
    const placed = await placeOrder();
    t.edges.receiptJudge.respond = pickLatest;
    const receiptId = await upload(placed);
    // credits that can never pay it: another amount, tiyin on top, another card, before the order
    await recordCredit(t, { som: placed.order.amountDue + 1000 });
    await recordCredit(t, { som: placed.order.amountDue, tiyin: 1 });
    await recordCredit(t, { som: placed.order.amountDue, last4: '0000' });
    await recordCredit(t, { som: placed.order.amountDue, at: new Date('2026-11-09T09:59:00Z') });
    await settled();
    // no candidate, no AI call: the receipt keeps waiting
    expect(t.edges.receiptJudge.calls).toHaveLength(0);
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
    expect(await statusOf(placed)).toBe('receipt_review');

    t.edges.clock.advance(4 * 60_000);
    const creditId = await recordCredit(t, { som: placed.order.amountDue });

    await vi.waitFor(async () => expect(await statusOf(placed)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    const [credit] = await t.db.select().from(credits).where(eq(credits.id, creditId));
    const receipt = await receiptNow(receiptId);
    expect(t.edges.receiptJudge.calls).toEqual([
      {
        image: t.edges.files.files.get(receipt.normalizedKey),
        mimeType: receipt.normalizedMime,
        amountDue: placed.order.amountDue,
        cardLast4: SHOP_LAST4,
        holderName: TEST_SHOP_CARD.holder,
        candidates: [{ creditId, amount: placed.order.amountDue, at: credit!.occurredAt }],
      },
    ]);
    expect(receipt.verdict).toBe('ai_confirmed');
    expect((await orderNow(placed.order.id)).creditId).toBe(creditId);
    const owner = await t.ownerSession();
    const audit = await owner.client.admin.audit.list({
      query: { action: 'order.payment_confirmed' },
    });
    expect(audit.status === 200 && audit.body.items).toMatchObject([
      { actorType: 'ai', targetId: String(placed.order.id), payload: { creditId, receiptId } },
    ]);
    expect((await said()).at(-1)).toContain(`Оплата заказа № ${placed.order.number} подтверждена`);
  });

  it('the credit arrives before the receipt: the upload itself starts the check', async () => {
    const placed = await placeOrder();
    t.edges.receiptJudge.respond = pickLatest;
    t.edges.clock.advance(2 * 60_000);
    const creditId = await recordCredit(t, { som: placed.order.amountDue });
    await settled();
    expect(t.edges.receiptJudge.calls).toHaveLength(0);

    const receiptId = await upload(placed);

    await vi.waitFor(async () => expect(await statusOf(placed)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    expect(t.edges.receiptJudge.calls.map((c) => c.candidates.map((x) => x.creditId))).toEqual([
      [creditId],
    ]);
    expect((await receiptNow(receiptId)).verdict).toBe('ai_confirmed');
    expect((await orderNow(placed.order.id)).creditId).toBe(creditId);
  });

  it('two candidates: the one the judge chose is linked, the other stays free', async () => {
    const placed = await placeOrder();
    t.edges.clock.advance(60_000);
    const someoneElses = await recordCredit(t, { som: placed.order.amountDue });
    t.edges.clock.advance(3 * 60_000);
    const own = await recordCredit(t, { som: placed.order.amountDue });
    await settled();
    t.edges.receiptJudge.respond = () => confirmedChoosing(own);

    await upload(placed);

    await vi.waitFor(async () => expect(await statusOf(placed)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    expect(t.edges.receiptJudge.calls).toHaveLength(1);
    expect(t.edges.receiptJudge.calls[0]!.candidates.map((c) => c.creditId)).toEqual([
      someoneElses,
      own,
    ]);
    expect((await orderNow(placed.order.id)).creditId).toBe(own);
    expect(await t.db.select().from(orders).where(eq(orders.creditId, someoneElses))).toEqual([]);
  });

  it('a credit already linked to an order is never shown again; the next one is', async () => {
    const paid = await placeOrder();
    t.edges.receiptJudge.respond = pickLatest;
    await upload(paid);
    const taken = await recordCredit(t, { som: paid.order.amountDue });
    await vi.waitFor(async () => expect(await statusOf(paid)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    await settled();
    // another shopper, same amount due, after the first credit
    const next = await placeOrder({ id: 42, first_name: 'Vali' }, '998907654321');
    expect(next.order.amountDue).toBe(paid.order.amountDue);
    t.edges.receiptJudge.calls.length = 0;

    const receiptId = await upload(next);
    await settled();
    expect(t.edges.receiptJudge.calls).toHaveLength(0);
    expect((await receiptNow(receiptId)).verdict).toBe('pending');

    t.edges.clock.advance(60_000);
    const own = await recordCredit(t, { som: next.order.amountDue });
    await vi.waitFor(async () => expect(await statusOf(next)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    expect(t.edges.receiptJudge.calls.map((c) => c.candidates.map((x) => x.creditId))).toEqual([
      [own],
    ]);
    expect((await orderNow(paid.order.id)).creditId).toBe(taken);
    expect((await orderNow(next.order.id)).creditId).toBe(own);
  });
});

describe('when the AI cannot confirm', () => {
  it('below a threshold: manual review, the shopper still reads «Чек на проверке», nothing is linked', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    const messages = (await said()).length;
    // the judge chose the credit but its own verdict is "not confirmed" (a predicate fell short)
    t.edges.receiptJudge.respond = (input) => ({
      ...confirmedChoosing(input.candidates[0]!.creditId),
      recipientMatches: 0.42,
      confirmed: false,
      reason: 'typesafe: below threshold',
    });

    await recordCredit(t, { som: placed.order.amountDue });

    await vi.waitFor(
      async () => expect((await receiptNow(receiptId)).verdict).toBe('manual_review'),
      { timeout: 15_000 },
    );
    await settled();
    expect(t.edges.receiptJudge.calls).toHaveLength(1);
    expect(await statusOf(placed)).toBe('receipt_review');
    expect((await orderNow(placed.order.id)).creditId).toBeNull();
    expect(await said()).toHaveLength(messages);
  });

  it('a "confirmed" naming a credit it was never shown is not trusted', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    const answering = hold();
    let notShown = 0;
    // asked about one credit, it names another that fits but arrived while it was answering
    t.edges.receiptJudge.respond = async (input) => {
      if (input.candidates.length > 1) return noneOfThese;
      await answering.held;
      return confirmedChoosing(notShown);
    };
    const shown = await recordCredit(t, { som: placed.order.amountDue });
    await vi.waitFor(() => expect(t.edges.receiptJudge.calls).toHaveLength(1), {
      timeout: 15_000,
    });
    t.edges.clock.advance(60_000);
    notShown = await recordCredit(t, { som: placed.order.amountDue });
    await vi.waitFor(
      async () => {
        const [c] = await t.db.select().from(credits).where(eq(credits.id, notShown));
        expect(c!.eventHandledAt).not.toBeNull();
      },
      { timeout: 15_000 },
    );

    answering.release();

    await vi.waitFor(
      async () => expect((await receiptNow(receiptId)).verdict).toBe('manual_review'),
      { timeout: 15_000 },
    );
    await settled();
    expect(t.edges.receiptJudge.calls.map((c) => c.candidates.map((x) => x.creditId))).toEqual([
      [shown],
      [shown, notShown],
    ]);
    expect((await orderNow(placed.order.id)).creditId).toBeNull();
    expect(await statusOf(placed)).toBe('receipt_review');
  });

  it('a judge that fails is manual review, asked once', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    t.edges.receiptJudge.respond = () => Promise.reject(new Error('provider down'));

    await recordCredit(t, { som: placed.order.amountDue });

    await vi.waitFor(
      async () => expect((await receiptNow(receiptId)).verdict).toBe('manual_review'),
      { timeout: 15_000 },
    );
    await settled();
    expect(t.edges.receiptJudge.calls).toHaveLength(1);
    expect(await statusOf(placed)).toBe('receipt_review');
  });
});

describe('races', () => {
  it('two receipts racing for one credit: one order is paid, the other keeps waiting for its own money', async () => {
    const x = await placeOrder();
    const y = await placeOrder(vali, '998907654321');
    const [rx, ry] = [await upload(x), await upload(y)];
    // both checks hold until both are asking, and both pick the one credit
    let asking = 0;
    const both = hold();
    t.edges.receiptJudge.respond = async (input) => {
      if (++asking === 2) both.release();
      await both.held;
      return pickLatest(input);
    };

    const credit = await recordCredit(t, { som: x.order.amountDue });

    await vi.waitFor(
      async () => {
        const verdicts = [(await receiptNow(rx)).verdict, (await receiptNow(ry)).verdict];
        expect(verdicts.sort()).toEqual(['ai_confirmed', 'pending']);
      },
      { timeout: 15_000 },
    );
    await settled();
    const winner = (await receiptNow(rx)).verdict === 'ai_confirmed' ? x : y;
    const loser = winner === x ? y : x;
    expect(await t.db.select().from(orders).where(eq(orders.creditId, credit))).toMatchObject([
      { id: winner.order.id },
    ]);
    expect(await statusOf(loser)).toBe('receipt_review');
    const loserChecks = await t.db
      .select()
      .from(receiptChecks)
      .where(eq(receiptChecks.receiptId, winner === x ? ry : rx));
    expect(loserChecks.map((c) => c.outcome)).toEqual(['credit_taken']);

    // the loser's own transfer arrives a minute later: it is paid with that one
    t.edges.clock.advance(60_000);
    const own = await recordCredit(t, { som: loser.order.amountDue });
    await vi.waitFor(async () => expect(await statusOf(loser)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    expect((await orderNow(loser.order.id)).creditId).toBe(own);
  });

  it('a credit arriving while the judge is answering is shown in a second question', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    const first = hold();
    t.edges.receiptJudge.respond = async (input) => {
      if (input.candidates.length === 1) {
        await first.held;
        return noneOfThese;
      }
      return pickLatest(input);
    };
    const someoneElses = await recordCredit(t, { som: placed.order.amountDue });
    await vi.waitFor(() => expect(t.edges.receiptJudge.calls).toHaveLength(1), {
      timeout: 15_000,
    });

    t.edges.clock.advance(60_000);
    const own = await recordCredit(t, { som: placed.order.amountDue });
    // its event is handled while the check is still running
    await vi.waitFor(
      async () => {
        const [c] = await t.db.select().from(credits).where(eq(credits.id, own));
        expect(c!.eventHandledAt).not.toBeNull();
      },
      { timeout: 15_000 },
    );
    first.release();

    await vi.waitFor(async () => expect(await statusOf(placed)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    expect(t.edges.receiptJudge.calls.map((c) => c.candidates.map((x) => x.creditId))).toEqual([
      [someoneElses],
      [someoneElses, own],
    ]);
    expect((await orderNow(placed.order.id)).creditId).toBe(own);
    expect((await receiptNow(receiptId)).verdict).toBe('ai_confirmed');
  });

  it('a manager confirms while the AI is answering: the answer changes nothing', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    const answering = hold();
    t.edges.receiptJudge.respond = async (input) => {
      await answering.held;
      return pickLatest(input);
    };
    const creditId = await recordCredit(t, { som: placed.order.amountDue });
    await vi.waitFor(() => expect(t.edges.receiptJudge.calls).toHaveLength(1), {
      timeout: 15_000,
    });
    const manager = await t.managerSession();
    const byHand = await t.app.get(PaymentConfirmation).confirmPayment({
      orderId: placed.order.id,
      creditId,
      receiptId,
      actor: { type: 'staff', id: manager.staff.id },
    });
    expect(byHand.kind).toBe('confirmed');

    answering.release();
    await settled();

    expect((await receiptNow(receiptId)).verdict).toBe('manager_confirmed');
    const confirmations = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.action, 'confirm_payment'));
    expect(confirmations).toMatchObject([{ actorType: 'staff', actorId: manager.staff.id }]);
    const [check] = await t.db.select().from(receiptChecks);
    expect(check!.outcome).toBe('stale');
  });
});

describe('re-matching and idempotency', () => {
  it('a receipt in manual review is asked again when a new candidate arrives', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    t.edges.receiptJudge.respond = (input) =>
      input.candidates.length === 1 ? noneOfThese : pickLatest(input);
    const someoneElses = await recordCredit(t, { som: placed.order.amountDue });
    await vi.waitFor(
      async () => expect((await receiptNow(receiptId)).verdict).toBe('manual_review'),
      { timeout: 15_000 },
    );

    t.edges.clock.advance(60_000);
    const own = await recordCredit(t, { som: placed.order.amountDue });

    await vi.waitFor(async () => expect(await statusOf(placed)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    expect(t.edges.receiptJudge.calls.map((c) => c.candidates.map((x) => x.creditId))).toEqual([
      [someoneElses],
      [someoneElses, own],
    ]);
    expect((await receiptNow(receiptId)).verdict).toBe('ai_confirmed');
  });

  it('the same event or job twice changes nothing the second time', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    t.edges.receiptJudge.respond = pickLatest;
    const creditId = await recordCredit(t, { som: placed.order.amountDue });
    await vi.waitFor(async () => expect(await statusOf(placed)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    await settled();
    const before = {
      events: await t.db.select().from(orderEvents),
      messages: await said(),
      checks: await t.db.select().from(receiptChecks),
    };

    // the event delivered again (at least once), the job run again, the sweep
    await t.db.update(credits).set({ eventHandledAt: null }).where(eq(credits.id, creditId));
    await t.app.get(CreditEvents).process(creditId);
    await t.app.get(PaymentMatching).check(receiptId);
    await worker.tick();
    await settled();

    expect(t.edges.receiptJudge.calls).toHaveLength(1);
    expect(await t.db.select().from(orderEvents)).toEqual(before.events);
    expect(await said()).toEqual(before.messages);
    expect(await t.db.select().from(receiptChecks)).toEqual(before.checks);
  });

  it('a receipt in manual review is not asked again about the same credits', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    t.edges.receiptJudge.respond = () => noneOfThese;
    const creditId = await recordCredit(t, { som: placed.order.amountDue });
    await vi.waitFor(
      async () => expect((await receiptNow(receiptId)).verdict).toBe('manual_review'),
      { timeout: 15_000 },
    );
    await settled();

    await t.db.update(credits).set({ eventHandledAt: null }).where(eq(credits.id, creditId));
    await t.app.get(CreditEvents).process(creditId);
    await t.app.get(PaymentMatching).check(receiptId);
    await worker.tick();
    await settled();

    expect(t.edges.receiptJudge.calls).toHaveLength(1);
    expect(await t.db.select().from(receiptChecks)).toHaveLength(1);
  });

  it('the sweep checks a receipt whose credit was missed (here: no card was set when it came)', async () => {
    const placed = await placeOrder();
    t.edges.receiptJudge.respond = pickLatest;
    const [card] = await t.db.select().from(shopCard);
    await t.db.delete(shopCard);
    await upload(placed);
    const creditId = await recordCredit(t, { som: placed.order.amountDue });
    await settled();
    expect(t.edges.receiptJudge.calls).toHaveLength(0);
    await t.db.insert(shopCard).values(card!);

    await worker.tick();

    await vi.waitFor(async () => expect(await statusOf(placed)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    expect((await orderNow(placed.order.id)).creditId).toBe(creditId);
  });
});

describe('duplicate receipts never confirm themselves', () => {
  it("a re-uploaded receipt never takes another shopper's same-amount credit, and the AI is not asked", async () => {
    const first = await placeOrder();
    const file = await uniqueReceiptImage();
    t.edges.receiptJudge.respond = pickLatest;
    await upload(first, file);
    await recordCredit(t, { som: first.order.amountDue });
    await vi.waitFor(async () => expect(await statusOf(first)).toBe('payment_confirmed'), {
      timeout: 15_000,
    });
    await settled();
    t.edges.receiptJudge.calls.length = 0;

    const second = await placeOrder(vali, '998907654321');
    const receiptId = await upload(second, file);
    expect(await receiptNow(receiptId)).toMatchObject({
      verdict: 'manual_review',
      reviewReason: 'duplicate',
    });
    t.edges.clock.advance(60_000);
    await recordCredit(t, { som: second.order.amountDue });
    await settled();
    await worker.tick();
    await settled();

    expect(t.edges.receiptJudge.calls).toHaveLength(0);
    expect(await statusOf(second)).toBe('receipt_review');
    expect((await orderNow(second.order.id)).creditId).toBeNull();
  });

  it('the same file on two waiting orders holds both for a person', async () => {
    const first = await placeOrder();
    const second = await placeOrder(vali, '998907654321');
    const file = await uniqueReceiptImage();
    const [r1, r2] = [await upload(first, file), await upload(second, file)];
    t.edges.receiptJudge.respond = pickLatest;

    await recordCredit(t, { som: first.order.amountDue });
    await settled();
    await worker.tick();
    await settled();

    expect(t.edges.receiptJudge.calls).toHaveLength(0);
    for (const id of [r1, r2])
      expect(await receiptNow(id)).toMatchObject({
        verdict: 'manual_review',
        reviewReason: 'duplicate',
      });
  });
});
