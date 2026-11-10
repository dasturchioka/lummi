import {
  and,
  credits,
  eq,
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
import type { Edges, ReceiptJudgement } from '../edges';
import type { Env } from '../env';
import { CreditEvents, type CreditRecorded } from '../humo/credit-events';
import { describeError } from '../logging/describe-error';
import { DISPATCH_TIMEOUT_MS, OutboxService } from '../outbox/outbox.service';
import { DB, EDGES, ENV } from '../tokens';
import { retryTransientOnce } from '../util/transient';
import { withTimeout } from '../util/with-timeout';
import { WorkerRuntime } from '../worker/runtime';
import { PaymentConfirmation } from './payment-confirmation';
import { CANDIDATE, sqlList, WAITING_VERDICTS } from './rules';
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

const NOT_CONFIRMED: Omit<ReceiptJudgement, 'reason'> = {
  isReceipt: 0,
  amountMatches: 0,
  recipientMatches: 0,
  chosenCreditId: null,
  choiceConfidence: 0,
  confirmed: false,
  provider: 'none',
};

/**
 * Automatic payment matching (ADR 0012, 0013): a receipt under check is confirmed by the AI once
 * the money is on the shop card, without a person.
 *
 * - **Candidate credits** (GLOSSARY) of an order: not linked to any order, `amount_som` equal to
 *   its Amount due (a credit with tiyin never is), on the shop card (same last 4), and no earlier
 *   than the minute the order was created (Humo keeps only the minute).
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
 * - Every answer is a `receipt_checks` row with the candidates it was shown, so the same event or
 *   job twice asks nothing the second time. Whoever loses a race for a credit (two receipts, one
 *   credit) hears `credit_taken` from the door and keeps waiting for its own money.
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
    @Inject(CreditEvents) creditEvents: CreditEvents,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    creditEvents.onCreditRecorded((event) => this.onCreditRecorded(event));
    runtime.register({
      name: 'receipt-matching',
      run: async () => void (await this.queueChecks()),
    });
    runtime.registerQueue({
      queue: env.RECEIPT_CHECKS_QUEUE,
      concurrency: CONCURRENCY,
      process: (job: Job<{ receiptId: number }>) => this.check(job.data.receiptId),
    });
  }

  /** Right after a receipt's upload commits. Never throws: if Redis is down, the sweep queues it. */
  async queueAfterCommit(receiptId: number): Promise<void> {
    try {
      await withTimeout(this.queueChecks({ receiptId }), DISPATCH_TIMEOUT_MS);
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
          backoff: { type: 'exponential', delay: 2000 },
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
   */
  async check(receiptId: number): Promise<void> {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const outcome = await this.checkOnce(receiptId);
      if (outcome === null || outcome === 'confirmed' || outcome === 'stale') return;
    }
  }

  /** One look at the receipt; null when there was nothing new to ask. */
  private async checkOnce(receiptId: number): Promise<CheckOutcome | null> {
    const [row] = await this.db
      .select({ receipt: receipts, order: orders })
      .from(receipts)
      .innerJoin(orders, eq(orders.id, receipts.orderId))
      .where(eq(receipts.id, receiptId));
    if (!row || row.order.status !== 'receipt_review') return null;
    if (!WAITING_VERDICTS.includes(row.receipt.verdict)) return null;
    const card = await readShopCard(this.db);
    if (!card) return null; // no card, no candidates: the receipt waits (#28 keeps uploads open)
    const candidates = await this.candidates(this.db, row.order);
    const shown = await this.shownCredits(receiptId);
    if (candidates.every((c) => shown.has(c.id))) return null;

    const judgement = await this.ask(row.receipt, row.order, card, candidates);
    return retryTransientOnce(() =>
      this.outbox.withTx((tx) =>
        this.settle(
          tx,
          row.receipt,
          candidates.map((c) => c.id),
          judgement,
        ),
      ),
    );
  }

  /** Candidate credits of an order, oldest first. */
  private async candidates(db: DbOrTx, order: OrderRow): Promise<Candidate[]> {
    const { rows } = await db.execute<{ id: string; occurred_at: string | Date }>(sql`
      select c.id, c.occurred_at
      from ${orders} o join ${shopCard} sc on true join ${credits} c on ${CANDIDATE}
      where o.id = ${order.id}
      order by c.occurred_at, c.id`);
    return rows.map((r) => ({ id: Number(r.id), occurredAt: new Date(r.occurred_at) }));
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
   * The waiting receipts (order «Чек на проверке», verdict pending or manual review) that have a
   * candidate they were never shown, in one query.
   */
  private async receiptsToCheck(only: { receiptId?: number; creditId?: number }) {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select distinct r.id
      from ${receipts} r
      join ${orders} o on o.id = r.order_id
      join ${shopCard} sc on true
      join ${credits} c on ${CANDIDATE}
      where o.status = 'receipt_review'
        and r.verdict in (${sqlList(WAITING_VERDICTS)})
        and not exists (
          select 1 from ${receiptChecks} k where k.receipt_id = r.id and c.id = any(k.candidate_credit_ids)
        )
        ${only.receiptId !== undefined ? sql`and r.id = ${only.receiptId}` : sql``}
        ${only.creditId !== undefined ? sql`and c.id = ${only.creditId}` : sql``}
      order by r.id`);
    return rows.map((r) => Number(r.id));
  }

  /** The judge's answer; a judge that throws or an image gone missing is "not confirmed". */
  private async ask(
    receipt: ReceiptRow,
    order: OrderRow,
    card: ShopCardRow,
    candidates: Candidate[],
  ): Promise<ReceiptJudgement> {
    const image = await this.edges.files.get(receipt.normalizedKey);
    if (!image) return { ...NOT_CONFIRMED, reason: 'the image for the AI is missing' };
    try {
      return await this.edges.receiptJudge.judge({
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
      this.log.error(`receipt ${receipt.id}: the judge failed: ${describeError(e)}`);
      return { ...NOT_CONFIRMED, reason: `judge failed: ${describeError(e)}` };
    }
  }

  /**
   * Act on the answer under the order's lock: only a `confirmed` answer with a candidate the judge
   * was shown pays the order (through the door, as the AI); anything else is manual review.
   */
  private async settle(
    tx: DbOrTx,
    receipt: ReceiptRow,
    candidateIds: number[],
    judgement: ReceiptJudgement,
  ): Promise<CheckOutcome> {
    const record = async (outcome: CheckOutcome) => {
      await tx.insert(receiptChecks).values({
        receiptId: receipt.id,
        candidateCreditIds: candidateIds,
        judgement: stored(judgement),
        outcome,
        createdAt: this.edges.clock.now(),
      });
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

    const chosen = judgement.chosenCreditId;
    if (judgement.confirmed && chosen !== null && candidateIds.includes(chosen)) {
      const out = await this.payments.confirmPaymentWithCredit(tx, {
        orderId: order.id,
        creditId: chosen,
        receiptId: receipt.id,
        actor: { type: 'ai' },
      });
      if (out.kind === 'confirmed') return record('confirmed');
      // another receipt's check took this credit first: wait for this shopper's own money
      if (out.kind === 'credit_taken') return record('credit_taken');
      this.log.warn(
        `receipt ${receipt.id}: the AI's credit was refused (${out.kind}); manual review`,
      );
    }
    await tx
      .update(receipts)
      .set({ verdict: 'manual_review' })
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
