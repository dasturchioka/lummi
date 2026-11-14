import {
  and,
  asc,
  credits,
  eq,
  isNull,
  orders,
  receiptChecks,
  receipts,
  shopCard,
  sql,
  type Db,
  type DbOrTx,
  type OrderRow,
  type ReceiptCheckRow,
  type ReceiptRow,
  type ShopCardRow,
  type StoredJudgement,
} from '@lummi/db';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { answered, type Edges, type ReceiptJudgement } from '../edges';
import type { Env } from '../env';
import { CreditEvents, type CreditRecorded } from '../humo/credit-events';
import { describeError } from '../logging/describe-error';
import { DISPATCH_TIMEOUT_MS, OutboxService } from '../outbox/outbox.service';
import { DB, EDGES, ENV } from '../tokens';
import { retryTransientOnce } from '../util/transient';
import { forEachSettled } from '../util/for-each-settled';
import { withTimeout } from '../util/with-timeout';
import { WorkerRuntime } from '../worker/runtime';
import { PaymentConfirmation } from './payment-confirmation';
import { PaymentNotFound } from './payment-not-found';
import {
  ACCEPTED_VERDICTS,
  candidatesOf,
  duplicateImageDistance,
  hasCandidate,
  isDuplicate,
  isDuplicateReceipt,
  isRepeat,
  sameReceipt,
  sqlList,
  twinOf,
  WAITING_VERDICTS,
} from './rules';
import { lastFour, readShopCard } from './shop-card.service';

const JOB = 'receipt.check';
const ATTEMPTS = 3;
/** Receipt checks at once; each waits on the AI for up to the two provider timeouts. */
const CONCURRENCY = 2;
/** A check asks again while new candidates keep arriving during it; past this the sweep takes over. */
const MAX_ROUNDS = 5;

/** One Candidate credit: its amount is the order's Amount due by definition. */
interface Candidate {
  id: number;
  occurredAt: Date;
}

type CheckOutcome = ReceiptCheckRow['outcome'];

/** What is kept when no provider answered. */
const NOT_ANSWERED: Omit<ReceiptJudgement, 'reason'> = {
  isReceipt: 0,
  amountMatches: 0,
  recipientMatches: 0,
  chosenCreditId: null,
  choiceConfidence: 0,
  confirmed: false,
  provider: 'none',
};

/** The judge gave no answer to act on (both providers failed, it threw, no image): try again. */
class JudgeUnavailable extends Error {
  constructor(readonly judgement: ReceiptJudgement) {
    super(`the receipt AI could not answer: ${judgement.reason ?? 'no reason given'}`);
  }
}

/**
 * Automatic payment matching (ADR 0012, 0013): a receipt under check is confirmed by the AI once
 * the money is on the shop card, without a person.
 *
 * - **Candidate credits** (GLOSSARY) of an order: not linked to any order and not marked «Не для
 *   заказа» (#49), `amount_som` equal to its Amount due (a credit with tiyin never is), on the shop
 *   card (same last 4), and no earlier than the minute the order was created (Humo keeps only the
 *   minute). The rule is `rules.ts`'s.
 * - A receipt is **checked** when it has a candidate it was never shown: right after the upload
 *   commits, on every "credit recorded" event, and by the `receipt-matching` sweep (the safety
 *   net for a lost queue entry). With none, nothing is asked and the receipt keeps waiting.
 * - The check is a BullMQ job (`jobId` receipt-<id>): it asks the `ReceiptJudge` about the image
 *   the upload normalised, with the amount due, the shop card's last 4 and holder and every
 *   candidate, holding no lock. **Only `confirmed` counts**: with a chosen candidate, the order is
 *   paid through `PaymentConfirmation` as the AI. Anything else makes the receipt manual review
 *   (the shopper still reads «Чек на проверке»). A receipt in manual review is still re-checked
 *   when a new candidate arrives, until a person decides (TZ §4: «система перепроверяет, пока
 *   менеджер не решит»).
 * - Every answer is a `receipt_checks` row with the candidates it was shown, stored before it is
 *   acted on, so the same event, job or retry asks nothing the second time. A judge that could
 *   not answer is not an answer: the job's attempts retry it, and only the last one sends the
 *   receipt to manual review. Whoever loses a race for a credit (two receipts, one credit) hears
 *   `credit_taken` from the door and keeps waiting for its own money.
 * - A duplicate receipt (`isDuplicate`) is never asked about: a repeat receipt takes the
 *   payment-not-found path at once (#36), the first receipt goes to manual review.
 */
@Injectable()
export class PaymentMatching implements OnApplicationShutdown {
  private readonly log = new Logger('PaymentMatching');
  private connection?: Redis;
  private queue?: Queue;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(PaymentConfirmation) private readonly payments: PaymentConfirmation,
    @Inject(PaymentNotFound) private readonly notFound: PaymentNotFound,
    @Inject(CreditEvents) creditEvents: CreditEvents,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    creditEvents.onCreditRecorded((event) => this.onCreditRecorded(event));
    runtime.register({
      name: 'receipt-matching',
      run: async () => {
        await this.holdDuplicates();
        await this.queueChecks();
      },
    });
    runtime.registerQueue({
      queue: env.RECEIPT_CHECKS_QUEUE,
      concurrency: CONCURRENCY,
      process: (job: Job<{ receiptId: number }>) =>
        this.check(job.data.receiptId, {
          lastAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
        }),
    });
  }

  /** Right after a receipt's upload commits. Never throws: if Redis is down, the sweep queues it. */
  async queueAfterCommit(receiptId: number): Promise<void> {
    try {
      await withTimeout(
        (async () => {
          await this.holdDuplicates({ receiptId });
          await this.queueChecks({ receiptId });
        })(),
        DISPATCH_TIMEOUT_MS,
      );
    } catch (e) {
      this.log.warn(`receipt ${receiptId}: check not queued, the sweep will: ${describeError(e)}`);
    }
  }

  /** "Credit recorded" (worker, at least once): check every waiting receipt this credit could pay. */
  async onCreditRecorded(event: CreditRecorded): Promise<void> {
    if (event.amountSom === null) return; // tiyin: never a candidate, a manager links it by hand
    await this.queueChecks({ creditId: event.creditId });
  }

  /**
   * Duplicates never confirm themselves (spec 2026-11-07): the AI is never asked about one. Of the
   * waiting receipts (only `receiptId` and its twins, or all: the sweep), a **repeat** (the same
   * receipt as one accepted, or as one sent earlier for another order) takes the payment-not-found
   * path at once (#36), marked with the receipt it repeats (`duplicate_of`), with a «Повторный чек»
   * post; the first receipt, which may be the honest one, goes to manual review (reason
   * `duplicate`) and keeps its own timers.
   */
  async holdDuplicates(only: { receiptId?: number } = {}): Promise<number[]> {
    const maxDistance = await duplicateImageDistance(this.db);
    const scope =
      only.receiptId !== undefined
        ? sql`and (r.id = ${only.receiptId} or exists (
            select 1 from ${receipts} x where x.id = ${only.receiptId} and ${sameReceipt('x', 'r', maxDistance)}))`
        : sql``;
    // the first receipt waits for a person (#32); the later one is decided below
    const { rows: held } = await this.db.execute<{ id: string }>(sql`
      update ${receipts} r set verdict = 'manual_review', review_reason = 'duplicate'
      where r.verdict in (${sqlList(WAITING_VERDICTS)})
        and r.review_reason is distinct from 'duplicate'
        and exists (select 1 from ${orders} o where o.id = r.order_id and o.status = 'receipt_review')
        and ${isDuplicate(maxDistance)}
        and not ${isRepeat(maxDistance)}
        ${scope}
      returning r.id`);
    const { rows: repeats } = await this.db.execute<{
      id: string;
      twin: string;
      same_file: boolean;
    }>(sql`
      select r.id, t.id as twin, t.same_file
      from ${receipts} r
      join ${orders} o on o.id = r.order_id
      cross join lateral (
        select twin.id, twin.sha256 = r.sha256 as same_file
        from ${receipts} twin
        where ${twinOf(maxDistance, { repeat: true })}
        order by twin.verdict in (${sqlList(ACCEPTED_VERDICTS)}) desc, twin.sha256 = r.sha256 desc, twin.id
        limit 1
      ) t
      where r.verdict in (${sqlList(WAITING_VERDICTS)}) and o.status = 'receipt_review' ${scope}
      order by r.id`);
    // one that fails does not hold up the others; the caller (or the sweep) hears of it
    await forEachSettled(repeats, (r) =>
      this.notFound.decide(Number(r.id), {
        kind: 'repeat',
        duplicateOf: Number(r.twin),
        sameFile: r.same_file,
      }),
    );
    return held.map((r) => Number(r.id));
  }

  /**
   * Queue a check for each waiting receipt with a candidate it was never shown (only `receiptId`,
   * or only those `creditId` is a candidate for; with neither, every one: the sweep).
   */
  async queueChecks(only: { receiptId?: number; creditId?: number } = {}): Promise<number[]> {
    const ids = await this.receiptsToCheck(only);
    if (ids.length === 0) return [];
    await this.getQueue().addBulk(
      ids.map((receiptId) => ({
        name: JOB,
        data: { receiptId },
        opts: {
          jobId: `receipt-${receiptId}`, // one live check per receipt
          attempts: ATTEMPTS,
          backoff: { type: 'exponential', delay: this.env.RECEIPT_CHECK_BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
    return ids;
  }

  /**
   * The job. Asks the judge while the receipt is waiting and has a candidate it was never shown,
   * again if credits arrived while it was asking (their own queue entry found this job running).
   * A judge that could not answer throws, so BullMQ tries again; on the `lastAttempt` the receipt
   * goes to manual review instead (`judge_failed`). An answer is final.
   */
  async check(receiptId: number, opts: { lastAttempt: boolean } = { lastAttempt: true }) {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const outcome = await this.checkOnce(receiptId, opts.lastAttempt);
      if (outcome === null || outcome === 'confirmed' || outcome === 'stale') return;
    }
  }

  /** One look at the receipt; null when there was nothing to ask or act on. */
  private async checkOnce(receiptId: number, lastAttempt: boolean): Promise<CheckOutcome | null> {
    const [row] = await this.db
      .select({ receipt: receipts, order: orders })
      .from(receipts)
      .innerJoin(orders, eq(orders.id, receipts.orderId))
      .where(eq(receipts.id, receiptId));
    if (!row || row.order.status !== 'receipt_review') return null;
    if (!WAITING_VERDICTS.includes(row.receipt.verdict)) return null;
    // an answer stored before a crash is acted on, never asked again
    const [unsettled] = await this.db
      .select()
      .from(receiptChecks)
      .where(and(eq(receiptChecks.receiptId, receiptId), isNull(receiptChecks.outcome)))
      .orderBy(asc(receiptChecks.id))
      .limit(1);
    if (unsettled) return this.settleInTx(row.receipt, unsettled);
    if (await isDuplicateReceipt(this.db, receiptId)) {
      await this.holdDuplicates({ receiptId });
      return null;
    }
    const card = await readShopCard(this.db);
    if (!card) return null; // no card, no candidates: the receipt waits (#28 keeps uploads open)
    const candidates = await this.candidates(this.db, row.order);
    const shown = await this.shownCredits(receiptId);
    if (candidates.every((c) => shown.has(c.id))) return null;

    let judgement: ReceiptJudgement;
    try {
      judgement = await this.ask(row.receipt, row.order, card, candidates);
    } catch (e) {
      if (!(e instanceof JudgeUnavailable) || !lastAttempt) throw e;
      this.log.error(`receipt ${receiptId}: the judge failed on the last attempt; manual review`);
      judgement = e.judgement;
    }
    // stored in its own transaction before anything is acted on: a crash after this point
    // settles the stored answer on the retry instead of asking again
    const [check] = await this.db
      .insert(receiptChecks)
      .values({
        receiptId,
        candidateCreditIds: candidates.map((c) => c.id),
        judgement: stored(judgement),
        createdAt: this.edges.clock.now(),
      })
      .returning();
    return this.settleInTx(row.receipt, check!);
  }

  private settleInTx(receipt: ReceiptRow, check: ReceiptCheckRow): Promise<CheckOutcome> {
    return retryTransientOnce(() => this.outbox.withTx((tx) => this.settle(tx, receipt, check)));
  }

  /** Candidate credits of an order, oldest first. */
  private candidates(db: DbOrTx, order: OrderRow): Promise<Candidate[]> {
    return db
      .select({ id: credits.id, occurredAt: credits.occurredAt })
      .from(credits)
      .where(sql`${credits.id} in (${candidatesOf(order.id)})`)
      .orderBy(asc(credits.occurredAt), asc(credits.id));
  }

  /** Every credit the judge was already shown for this receipt. */
  private async shownCredits(receiptId: number): Promise<Set<number>> {
    const rows = await this.db
      .select({ ids: receiptChecks.candidateCreditIds })
      .from(receiptChecks)
      .where(eq(receiptChecks.receiptId, receiptId));
    return new Set(rows.flatMap((r) => r.ids));
  }

  /**
   * The waiting receipts (order «Чек на проверке», verdict pending or manual review) to check: one
   * with an answer stored but not acted on, or one that is no duplicate and has a candidate it was
   * never shown (only `receiptId`, or only those `creditId` is such a candidate for).
   */
  private async receiptsToCheck(only: { receiptId?: number; creditId?: number }) {
    const maxDistance = await duplicateImageDistance(this.db);
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select r.id
      from ${receipts} r
      join ${orders} o on o.id = r.order_id
      where o.status = 'receipt_review'
        and r.verdict in (${sqlList(WAITING_VERDICTS)})
        ${only.receiptId !== undefined ? sql`and r.id = ${only.receiptId}` : sql``}
        and (
          exists (
            select 1 from ${receiptChecks} k where k.receipt_id = r.id and k.outcome is null
          )
          or (
            not ${isDuplicate(maxDistance)}
            and ${hasCandidate(sql`not exists (
                select 1 from ${receiptChecks} k
                where k.receipt_id = r.id and c.id = any(k.candidate_credit_ids)
              )
              ${only.creditId !== undefined ? sql`and c.id = ${only.creditId}` : sql``}`)}
          )
        )
      order by r.id`);
    return rows.map((r) => Number(r.id));
  }

  /**
   * The judge's answer, confirmed or not. Throws `JudgeUnavailable` when there is none to act on:
   * the judge threw, no provider answered (`answered()`), or the image for it is gone.
   */
  private async ask(
    receipt: ReceiptRow,
    order: OrderRow,
    card: ShopCardRow,
    candidates: Candidate[],
  ): Promise<ReceiptJudgement> {
    const image = await this.edges.files.get(receipt.normalizedKey);
    if (!image)
      throw new JudgeUnavailable({ ...NOT_ANSWERED, reason: 'the image for the AI is missing' });
    let judgement: ReceiptJudgement;
    try {
      judgement = await this.edges.receiptJudge.judge({
        image,
        mimeType: receipt.normalizedMime === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        amountDue: order.amountDue,
        cardLast4: lastFour(card),
        holderName: card.holder,
        candidates: candidates.map((c) => ({
          creditId: c.id,
          amount: order.amountDue,
          at: c.occurredAt,
        })),
      });
    } catch (e) {
      throw new JudgeUnavailable({ ...NOT_ANSWERED, reason: `judge failed: ${describeError(e)}` });
    }
    if (!answered(judgement)) throw new JudgeUnavailable(judgement);
    return judgement;
  }

  /**
   * Act on a stored answer under the order's lock: only a `confirmed` answer naming a candidate the
   * judge was shown pays the order (through the door, as the AI); anything else is manual review.
   * The answer's row gets its outcome in the same transaction.
   */
  private async settle(
    tx: DbOrTx,
    receipt: ReceiptRow,
    check: ReceiptCheckRow,
  ): Promise<CheckOutcome> {
    const record = async (outcome: CheckOutcome) => {
      await tx.update(receiptChecks).set({ outcome }).where(eq(receiptChecks.id, check.id));
      return outcome;
    };
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, receipt.orderId))
      .for('update');
    const [verdictNow] = await tx
      .select({ verdict: receipts.verdict })
      .from(receipts)
      .where(eq(receipts.id, receipt.id));
    // decided while the AI was answering (a manager, the wait window): the answer changes nothing
    if (
      order?.status !== 'receipt_review' ||
      !verdictNow ||
      !WAITING_VERDICTS.includes(verdictNow.verdict)
    )
      return record('stale');

    const { judgement } = check;
    const chosen = judgement.chosenCreditId;
    let why: ReceiptRow['reviewReason'] = answered(judgement) ? 'not_confirmed' : 'judge_failed';
    if (judgement.confirmed && chosen !== null && check.candidateCreditIds.includes(chosen)) {
      const out = await this.payments.confirmPaymentWithCredit(tx, {
        orderId: order.id,
        creditId: chosen,
        receiptId: receipt.id,
        actor: { type: 'ai' },
      });
      if (out.kind === 'confirmed') return record('confirmed');
      // another receipt's check took this credit first: wait for this shopper's own money
      if (out.kind === 'credit_taken') return record('credit_taken');
      if (out.kind === 'duplicate_receipt') why = 'duplicate';
      else this.log.warn(`receipt ${receipt.id}: the AI's credit was refused (${out.kind})`);
    }
    await tx
      .update(receipts)
      .set({ verdict: 'manual_review', reviewReason: why })
      .where(and(eq(receipts.id, receipt.id), eq(receipts.verdict, 'pending')));
    return record('manual_review');
  }

  private getQueue(): Queue {
    if (!this.queue) {
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 1 });
      this.connection.on('error', (e) => this.log.warn(`redis: ${describeError(e)}`));
      this.queue = new Queue(this.env.RECEIPT_CHECKS_QUEUE, { connection: this.connection });
    }
    return this.queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}

/** The judge's answer as `receipt_checks` keeps it. */
function stored(j: ReceiptJudgement): StoredJudgement {
  return {
    isReceipt: j.isReceipt,
    amountMatches: j.amountMatches,
    recipientMatches: j.recipientMatches,
    chosenCreditId: j.chosenCreditId,
    choiceConfidence: j.choiceConfidence,
    confirmed: j.confirmed,
    provider: j.provider,
    ...(j.reason ? { reason: j.reason } : {}),
  };
}
