import {
  and,
  credits,
  eq,
  humoMessages,
  inArray,
  isNull,
  orders,
  paymentPauses,
  receipts,
  sql,
  userbotHeartbeat,
  type DbOrTx,
  type SQL,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AlertService } from '../outbox/alert.service';
import { readSettings } from '../settings/settings.service';
import { WAITING_VERDICTS } from './rules';
import { pauseEndedAlert, pauseStartedAlert } from './staff-posts';

/** An instant as a bound `timestamptz`. */
export const at = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * Seconds the payment feed was paused after `from` (an SQL instant) up to `now`; an open pause
 * counts up to `now`. Each receipt's wait window, and its order's reserve, are extended by this.
 */
export function pausedSecondsAfter(from: SQL, now: Date): SQL<number> {
  return sql<number>`(
    select coalesce(sum(extract(epoch from (
      least(coalesce(p.ended_at, ${at(now)}), ${at(now)}) - greatest(p.started_at, ${from})
    ))), 0)::double precision
    from ${paymentPauses} p
    where p.started_at < ${at(now)} and coalesce(p.ended_at, ${at(now)}) > ${from}
  )`;
}

/** A pause is open now. */
export const PAUSED = sql`exists (select 1 from ${paymentPauses} p where p.ended_at is null)`;

/** How the feed stands: why it is down (null: it is fine), and since when. */
interface FeedState {
  cause: 'heartbeat' | 'silence' | null;
  /** The last heartbeat or credit, for the alert; null when there never was one. */
  since: Date | null;
  /** Some receipt waits for its money (a pause matters only then). */
  receiptsWait: boolean;
}

/**
 * The payment feed guard (ADR 0012, #36): while the userbot is down or Humo is silent, every
 * receipt timer pauses, so an outage never cancels a paid order.
 *
 * - **Down**: the userbot's heartbeat is older than `payments.heartbeatStaleSeconds` (or never
 *   came), or receipts wait and no credit has arrived for `payments.humoSilenceSeconds` (counted
 *   from the last credit, or from the oldest waiting receipt if that came later, TZ §4 «пока чеки
 *   ждут»).
 * - **Pause intervals are stored** (`payment_pauses`), not deadlines shifted: a pause opens on the
 *   worker's minute when the feed is down while a receipt waits, and closes on the first minute it
 *   is fine again. Each receipt's wait window and its order's reserve are extended by the part of
 *   every pause after the receipt was sent (`pausedSecondsAfter`); the reserve is written back
 *   when payment not found decides the receipt.
 * - **Alerts**: opening a pause alerts the owner once, closing it alerts the recovery, each in the
 *   transaction that writes the row, so a tick that runs twice alerts nothing twice.
 */
@Injectable()
export class PaymentPauses {
  constructor(@Inject(AlertService) private readonly alerts: AlertService) {}

  /**
   * Open or close the pause as the feed stands at `now`, in the caller's transaction; true while
   * paused.
   */
  async check(tx: DbOrTx, now: Date): Promise<boolean> {
    const [open] = await tx
      .select()
      .from(paymentPauses)
      .where(isNull(paymentPauses.endedAt))
      .for('update');
    const feed = await this.feed(tx, now);
    if (open) {
      if (feed.cause) return true;
      const [closed] = await tx
        .update(paymentPauses)
        .set({ endedAt: now })
        .where(and(eq(paymentPauses.id, open.id), isNull(paymentPauses.endedAt)))
        .returning();
      if (closed)
        await this.alerts.alertOwner(
          tx,
          pauseEndedAlert({ startedAt: open.startedAt, endedAt: now }),
        );
      return false;
    }
    if (!feed.cause || !feed.receiptsWait) return false;
    const [opened] = await tx
      .insert(paymentPauses)
      .values({ cause: feed.cause, startedAt: now })
      .onConflictDoNothing()
      .returning();
    if (opened)
      await this.alerts.alertOwner(tx, pauseStartedAlert({ cause: feed.cause, since: feed.since }));
    return true;
  }

  /** Seconds the feed was paused after `from` up to `now`, rounded up. */
  async pausedSeconds(tx: DbOrTx, from: Date, now: Date): Promise<number> {
    const { rows } = await tx.execute<{ s: number | string }>(
      sql`select ${pausedSecondsAfter(at(from), now)} as s`,
    );
    return Math.ceil(Number(rows[0]?.s ?? 0));
  }

  private async feed(tx: DbOrTx, now: Date): Promise<FeedState> {
    const s = await readSettings(tx, [
      'payments.heartbeatStaleSeconds',
      'payments.humoSilenceSeconds',
    ]);
    const [beat] = await tx.select({ seenAt: userbotHeartbeat.seenAt }).from(userbotHeartbeat);
    const [waiting] = await tx
      .select({ oldest: sql`min(${receipts.createdAt})`.mapWith(receipts.createdAt) })
      .from(receipts)
      .innerJoin(orders, eq(orders.id, receipts.orderId))
      .where(
        and(eq(orders.status, 'receipt_review'), inArray(receipts.verdict, [...WAITING_VERDICTS])),
      );
    const oldest = waiting?.oldest ?? null;
    const receiptsWait = oldest !== null;
    const age = (d: Date) => now.getTime() - d.getTime();

    if (!beat || age(beat.seenAt) > s['payments.heartbeatStaleSeconds'] * 1000)
      return { cause: 'heartbeat', since: beat?.seenAt ?? null, receiptsWait };
    if (!oldest) return { cause: null, since: null, receiptsWait };
    const [last] = await tx
      .select({ at: sql`max(${humoMessages.receivedAt})`.mapWith(humoMessages.receivedAt) })
      .from(credits)
      .innerJoin(humoMessages, eq(humoMessages.messageId, credits.humoMessageId));
    const lastCredit = last?.at ?? null;
    const quietSince = lastCredit && lastCredit > oldest ? lastCredit : oldest;
    if (age(quietSince) > s['payments.humoSilenceSeconds'] * 1000)
      return { cause: 'silence', since: lastCredit, receiptsWait };
    return { cause: null, since: null, receiptsWait };
  }
}
