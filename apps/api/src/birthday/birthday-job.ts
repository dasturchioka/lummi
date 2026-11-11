import {
  and,
  birthdayCoupons,
  customers,
  eq,
  isNotNull,
  sql,
  type CustomerRow,
  type Db,
} from '@lummi/db';
import { fill, formatCalendarDate, formatMoney } from '@lummi/i18n';
import { botMessages } from '@lummi/i18n/bot';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CustomersService } from '../auth/customers.service';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { OutboxService, type OutboxMessage } from '../outbox/outbox.service';
import { readSettings } from '../settings/settings.service';
import { describeError } from '../logging/describe-error';
import { DB, EDGES, ENV } from '../tokens';
import { WorkerRuntime } from '../worker/runtime';
import { readBirthdayRules } from './birthday-coupons';
import {
  birthDaysOpenOn,
  formatLocalDate,
  lastDayOf,
  openWindow,
  parseLocalDate,
  passesGuard,
  tashkentDay,
  type CouponWindow,
} from './birthday-dates';

/** The repeatable job's id: one per queue, upserted on every worker start. */
const SCHEDULE_ID = 'birthday-coupons';
/** A run that failed for some customers is run again (they are idempotent) after 1, 2, 4 minutes. */
const RUN_ATTEMPTS = 4;

/**
 * The birthday-coupon job (TZ §3.8, ticket #30; ADR 0021): a BullMQ repeatable job at the start of
 * every hour on the Asia/Tashkent clock, so the setting `birthday.issueHour` (TZ: 10:00, changed in
 * the admin) is read at each run, never baked into a schedule. Each run issues a coupon to every
 * customer whose window is open at that moment (from `issueHour` on the day `birthday.daysBefore`
 * days before the birthday through `birthday.daysAfter` days after it), so a run the worker missed
 * is caught up while the window lasts and never early.
 *
 * One coupon per customer per birthday year: the unique index on (customer, birthday year) makes a
 * second or concurrent run insert nothing, and the message is queued only with the row it inserted,
 * in the same transaction (the outbox). A customer the bot cannot message (blocked, write access
 * refused) gets the coupon all the same, with no message. Percent and cap are read from the
 * settings at issue and fixed on the coupon.
 */
@Injectable()
export class BirthdayCouponJob {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    runtime.registerQueue({
      queue: env.BIRTHDAY_QUEUE,
      schedules: [
        { id: SCHEDULE_ID, pattern: '0 * * * *', tz: 'Asia/Tashkent', attempts: RUN_ATTEMPTS },
      ],
      process: async () => void (await this.run()),
    });
  }

  private readonly log = new Logger('BirthdayCoupons');

  /**
   * Issues every coupon due now; returns how many it issued. One customer's failure is logged (no
   * personal data) and does not stop the others; the run then fails, so BullMQ runs it again.
   */
  async run(): Promise<number> {
    const now = this.edges.clock.now();
    const rules = await readBirthdayRules(this.db);
    const days = birthDaysOpenOn(tashkentDay(now), rules);
    const pairs = sql.join(
      days.map((d) => sql`(${d.month}::int, ${d.day}::int)`),
      sql`, `,
    );
    // an order needs the account phone, and so does the date (one phone, one account)
    const candidates = await this.db
      .select()
      .from(customers)
      .where(
        and(
          isNotNull(customers.birthDate),
          isNotNull(customers.phone),
          sql`(extract(month from ${customers.birthDate})::int, extract(day from ${customers.birthDate})::int) in (${pairs})`,
        ),
      );
    let issued = 0;
    let due = 0;
    let failed = 0;
    for (const c of candidates) {
      if (c.birthDate === null || c.birthDateSetAt === null) continue;
      const w = openWindow(parseLocalDate(c.birthDate), now, rules);
      if (!w || !passesGuard(w, c.birthDateSetAt, rules)) continue;
      due++;
      try {
        if (await this.issue(c, w, now)) issued++;
      } catch (e) {
        failed++;
        this.log.error(`customer ${c.id}: coupon not issued: ${describeError(e)}`);
      }
    }
    if (failed > 0)
      throw new Error(`birthday coupons: ${failed} of ${due} customers failed (${issued} issued)`);
    return issued;
  }

  private async issue(c: CustomerRow, w: CouponWindow, now: Date): Promise<boolean> {
    return this.outbox.withTx(async (tx) => {
      const terms = await readSettings(tx, ['birthday.percent', 'birthday.maxAmount']);
      const [coupon] = await tx
        .insert(birthdayCoupons)
        .values({
          customerId: c.id,
          birthdayYear: w.birthdayYear,
          birthday: formatLocalDate(w.birthday),
          percent: terms['birthday.percent'],
          maxAmount: terms['birthday.maxAmount'],
          issuedAt: now,
          expiresAt: w.expiresAt,
        })
        .onConflictDoNothing({ target: [birthdayCoupons.customerId, birthdayCoupons.birthdayYear] })
        .returning();
      if (!coupon) return false;
      // read in this transaction: the run holds a pool connection already
      if (await this.customers.canMessage(c.telegramId, tx)) {
        const [outboxId] = await this.outbox.enqueue(tx, this.message(c, coupon));
        await tx.update(birthdayCoupons).set({ outboxId }).where(eq(birthdayCoupons.id, coupon.id));
      }
      return true;
    });
  }

  private message(
    c: CustomerRow,
    coupon: { percent: number; maxAmount: number; expiresAt: Date },
  ): OutboxMessage {
    const t = botMessages[c.language].bot;
    const url = this.env.MINIAPP_URL;
    return {
      chatId: c.telegramId,
      text: fill(t.birthdayCoupon, {
        percent: String(coupon.percent),
        max: formatMoney(coupon.maxAmount, c.language),
        until: formatCalendarDate(formatLocalDate(lastDayOf(coupon.expiresAt)), c.language),
      }),
      options: url
        ? { reply_markup: { inline_keyboard: [[{ text: t.openShop, web_app: { url } }]] } }
        : {},
    };
  }
}
