import { effectiveFeedGuard } from '@lummi/contracts';
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
  shopCard,
  sql,
  userbotHeartbeat,
  type DbOrTx,
  type PaymentPauseRow,
  type SQL,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AlertService } from '../outbox/alert.service';
import { readSettings } from '../settings/settings.service';
import { CANDIDATE, WAITING_VERDICTS } from './rules';
import { pauseEndedAlert, pauseStartedAlert } from './staff-posts';

/** An instant as a bound `timestamptz`. */
export const sqlInstant = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * A pause shorter than this is announced neither when it starts nor when it ends: a heartbeat
 * hiccup, a credit a minute after the silence threshold. A technical guard against alert churn,
 * not a rule value (so not a setting); the pause's time still extends the timers.
 */
const ANNOUNCE_AFTER_SECONDS = 5 * 60;

/**
 * Seconds the feed was paused after `from` (an SQL instant) up to `now`; an open pause counts up
 * to `now`. Each receipt's wait window, and its order's reserve, are extended by this.
 */
export function pausedSecondsAfter(from: SQL, now: Date): SQL<number> {
  return sql<number>`(
    select coalesce(sum(extract(epoch from (
      least(coalesce(p.ended_at, ${sqlInstant(now)}), ${sqlInstant(now)}) - greatest(p.started_at, ${from})
    ))), 0)::double precision
    from ${paymentPauses} p
    where p.started_at < ${sqlInstant(now)} and coalesce(p.ended_at, ${sqlInstant(now)}) > ${from}
  )`;
}

/** A payment pause is open now. */
export const PAUSED = sql`exists (select 1 from ${paymentPauses} p where p.ended_at is null)`;

/** How the feed stands at a moment. */
interface FeedState {
  /** The userbot's last heartbeat is older than its guard, or there never was one. */
  heartbeatStale: boolean;
  lastBeat: Date | null;
  /** A receipt waits for its money with no candidate, and no credit came for the silence guard. */
  silent: boolean;
  /** When the last credit was received; null before the first. */
  lastCredit: Date | null;
  /** The oldest receipt waiting (pending or manual review); null when none waits. */
  oldestWaiting: Date | null;
}

/**
 * The payment-feed guard (ADR 0012, #36): while the userbot is down or Humo is silent, every
 * receipt timer pauses (a payment pause), so a feed failure never cancels a paid order.
 *
 * - **Heartbeat**: the userbot's last heartbeat is older than `payments.heartbeatStaleSeconds`
 *   (or never came) while a receipt waits. The pause starts **at that last heartbeat**, so the
 *   detection lag is paused too.
 * - **Silence**: a receipt waits for its money with **no candidate** (pending; one held for a
 *   person never arms it), and no credit was received for `payments.humoSilenceSeconds`, counted
 *   from the last credit or from that receipt if it came later. The pause starts when noticed.
 * - Both guards are clamped a tick under the wait window and the reserve
 *   (`effectiveFeedGuard`), whatever is stored; the settings service refuses such a save.
 * - **Ending** needs proof the feed is alive: a fresh heartbeat, no silence, and for a silence
 *   pause a credit received since it started. Receipts coming and going end nothing.
 * - **Stored intervals** (`payment_pauses`), not shifted deadlines: each receipt's window and its
 *   order's reserve are extended by the part of every pause after the receipt was sent
 *   (`pausedSecondsAfter`); the moves that send the order back to «Ожидает оплаты» (payment not
 *   found, a rejection) write the reserve back.
 * - **Alerts**: once a pause has lasted `ANNOUNCE_AFTER_SECONDS`, the owner is told once; its end is
 *   told only for an announced pause. Each in the transaction that stamps the row.
 */
@Injectable()
export class PaymentPauses {
  constructor(@Inject(AlertService) private readonly alerts: AlertService) {}

  /**
   * Open, announce or end the pause as the feed stands at `now`, in the caller's transaction;
   * true while paused. The worker's minute calls it.
   */
  async check(tx: DbOrTx, now: Date): Promise<boolean> {
    const [open] = await tx
      .select()
      .from(paymentPauses)
      .where(isNull(paymentPauses.endedAt))
      .for('update');
    const feed = await this.feed(tx, now);
    if (open) {
      const alive =
        !feed.heartbeatStale &&
        !feed.silent &&
        (open.cause === 'heartbeat' ||
          (feed.lastCredit !== null && feed.lastCredit > open.startedAt));
      if (!alive) {
        await this.announce(tx, open, feed, now);
        return true;
      }
      const [ended] = await tx
        .update(paymentPauses)
        .set({ endedAt: now })
        .where(and(eq(paymentPauses.id, open.id), isNull(paymentPauses.endedAt)))
        .returning();
      if (ended?.announcedAt)
        await this.alerts.alertOwner(
          tx,
          pauseEndedAlert({ startedAt: open.startedAt, endedAt: now }),
        );
      return false;
    }

    const heartbeat = feed.heartbeatStale && feed.oldestWaiting !== null;
    if (!heartbeat && !feed.silent) return false;
    const [opened] = await tx
      .insert(paymentPauses)
      .values(
        heartbeat
          ? { cause: 'heartbeat', startedAt: feed.lastBeat ?? feed.oldestWaiting! }
          : { cause: 'silence', startedAt: now },
      )
      .onConflictDoNothing()
      .returning();
    if (opened) await this.announce(tx, opened, feed, now);
    return true;
  }

  /** Seconds the feed was paused after `from` up to `now`, rounded up. */
  async pausedSeconds(tx: DbOrTx, from: Date, now: Date): Promise<number> {
    const { rows } = await tx.execute<{ s: number | string }>(
      sql`select ${pausedSecondsAfter(sqlInstant(from), now)} as s`,
    );
    return Math.ceil(Number(rows[0]?.s ?? 0));
  }

  /** Tell the owner once the pause has lasted long enough to be more than a hiccup. */
  private async announce(tx: DbOrTx, pause: PaymentPauseRow, feed: FeedState, now: Date) {
    if (pause.announcedAt) return;
    if (now.getTime() - pause.startedAt.getTime() < ANNOUNCE_AFTER_SECONDS * 1000) return;
    const [stamped] = await tx
      .update(paymentPauses)
      .set({ announcedAt: now })
      .where(and(eq(paymentPauses.id, pause.id), isNull(paymentPauses.announcedAt)))
      .returning();
    if (!stamped) return;
    await this.alerts.alertOwner(
      tx,
      pauseStartedAlert(
        pause.cause === 'heartbeat'
          ? { cause: 'heartbeat', since: feed.lastBeat }
          : { cause: 'silence', since: feed.lastCredit },
      ),
    );
  }

  private async feed(tx: DbOrTx, now: Date): Promise<FeedState> {
    const s = await readSettings(tx, [
      'payments.heartbeatStaleSeconds',
      'payments.humoSilenceSeconds',
      'payments.notFoundAfterSeconds',
      'orders.reserveTtlSeconds',
    ]);
    const staleAfter = effectiveFeedGuard(s['payments.heartbeatStaleSeconds'], s);
    const silentAfter = effectiveFeedGuard(s['payments.humoSilenceSeconds'], s);
    const age = (d: Date) => now.getTime() - d.getTime();

    const [beat] = await tx.select({ seenAt: userbotHeartbeat.seenAt }).from(userbotHeartbeat);
    const lastBeat = beat?.seenAt ?? null;
    const [waiting] = await tx
      .select({ oldest: sql`min(${receipts.createdAt})`.mapWith(receipts.createdAt) })
      .from(receipts)
      .innerJoin(orders, eq(orders.id, receipts.orderId))
      .where(
        and(eq(orders.status, 'receipt_review'), inArray(receipts.verdict, [...WAITING_VERDICTS])),
      );
    // only a receipt still waiting for its money arms the silence guard: one with a candidate,
    // or held for a person, is not waiting on Humo (ADR 0012 hands it to a person)
    const { rows: unpaid } = await tx.execute<{ oldest: string | Date | null }>(sql`
      select min(r.created_at) as oldest
      from ${receipts} r join ${orders} o on o.id = r.order_id
      where o.status = 'receipt_review' and r.verdict = 'pending'
        and not exists (select 1 from ${shopCard} sc join ${credits} c on ${CANDIDATE})`);
    const oldestUnpaid = unpaid[0]?.oldest ? new Date(unpaid[0].oldest) : null;
    const [last] = await tx
      .select({ at: sql`max(${humoMessages.receivedAt})`.mapWith(humoMessages.receivedAt) })
      .from(credits)
      .innerJoin(humoMessages, eq(humoMessages.messageId, credits.humoMessageId));
    const lastCredit = last?.at ?? null;
    const quietSince =
      oldestUnpaid && lastCredit && lastCredit > oldestUnpaid ? lastCredit : oldestUnpaid;
    return {
      heartbeatStale: !lastBeat || age(lastBeat) > staleAfter * 1000,
      lastBeat,
      silent: quietSince !== null && age(quietSince) > silentAfter * 1000,
      lastCredit,
      oldestWaiting: waiting?.oldest ?? null,
    };
  }
}
