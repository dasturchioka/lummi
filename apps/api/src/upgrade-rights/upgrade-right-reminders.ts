import {
  and,
  customers,
  gt,
  inArray,
  isNull,
  lte,
  sql,
  upgradeRights,
  type CustomerRow,
  type DbOrTx,
  type UpgradeRightRow,
} from '@lummi/db';
import { fill, formatDayMonth } from '@lummi/i18n';
import { botMessages } from '@lummi/i18n/bot';
import { Inject, Injectable } from '@nestjs/common';
import { CustomersService } from '../auth/customers.service';
import type { Env } from '../env';
import type { OutboxMessage } from '../outbox/outbox.service';
import { readSettings } from '../settings/settings.service';
import { ENV } from '../tokens';
import { WorkerRuntime, type SweepContext } from '../worker/runtime';

const DAY_MS = 86_400_000;

/**
 * The upgrade-right reminders (TZ §3.4: «Бот напоминает за 7 и 1 день до окончания, если не
 * использовано»; ADR 0021), a worker sweep every minute. A reminder N days before the end goes at
 * `upgradeRights.reminderHour` Tashkent on the day N days before the right's last day, while the
 * right is unused, open and not ended. Its marker is stamped by the statement that claims it, in
 * the transaction that queues the message, so running twice sends nothing twice. The first one
 * goes only before the last one is due (a worker that was down sends only the last), and neither
 * goes for a moment that came before the right opened. A customer the bot cannot message (blocked,
 * write access refused) gets no message; the right stays in their profile and on the cards.
 */
@Injectable()
export class UpgradeRightReminders {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    runtime.register({ name: 'upgrade-right-reminders', run: (ctx) => this.remind(ctx) });
  }

  async remind({ now, withTx, outbox }: SweepContext): Promise<void> {
    await withTx(async (tx) => {
      const s = await readSettings(tx, [
        'upgradeRights.firstReminderDays',
        'upgradeRights.lastReminderDays',
        'upgradeRights.reminderHour',
      ]);
      const hour = s['upgradeRights.reminderHour'];
      const lastDays = s['upgradeRights.lastReminderDays'];
      const firstDays = s['upgradeRights.firstReminderDays'];
      // the moment of the reminder `days` before the last day: `expires_at` is 00:00 Tashkent the
      // day after it, and Tashkent keeps one offset all year
      const moment = (days: number) =>
        sql`${upgradeRights.expiresAt} - make_interval(days => ${days + 1}) + make_interval(hours => ${hour})`;
      const open = and(
        isNull(upgradeRights.usedByOrderId),
        isNull(upgradeRights.closedAt),
        gt(upgradeRights.expiresAt, now),
      );
      const last = await tx
        .update(upgradeRights)
        .set({ lastReminderAt: now })
        .where(
          and(
            open,
            isNull(upgradeRights.lastReminderAt),
            lte(moment(lastDays), now),
            sql`${upgradeRights.openedAt} < ${moment(lastDays)}`,
          ),
        )
        .returning();
      const first = await tx
        .update(upgradeRights)
        .set({ firstReminderAt: now })
        .where(
          and(
            open,
            isNull(upgradeRights.firstReminderAt),
            lte(moment(firstDays), now),
            gt(moment(lastDays), now),
            sql`${upgradeRights.openedAt} < ${moment(firstDays)}`,
          ),
        )
        .returning();
      const due = [...last, ...first];
      if (due.length === 0) return;

      const recipients = await this.recipients(tx, due);
      const messages: OutboxMessage[] = [];
      for (const right of due) {
        const c = recipients.get(right.customerId);
        if (!c) throw new Error(`upgrade right ${right.id} has no customer`);
        if (await this.customers.canMessage(c.telegramId)) messages.push(this.message(c, right));
      }
      await outbox.enqueue(tx, messages);
    });
  }

  private async recipients(tx: DbOrTx, rights: UpgradeRightRow[]) {
    const ids = [...new Set(rights.map((r) => r.customerId))];
    const rows = await tx.select().from(customers).where(inArray(customers.id, ids));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private message(c: CustomerRow, right: UpgradeRightRow): OutboxMessage {
    const t = botMessages[c.language].bot;
    const url = this.env.MINIAPP_URL;
    return {
      chatId: c.telegramId,
      text: fill(t.upgradeRightReminder[right.source], {
        percent: String(right.percent),
        until: formatDayMonth(new Date(right.expiresAt.getTime() - DAY_MS), c.language),
        names: right.fragrances.map((f) => f.name).join(', '),
      }),
      options: url
        ? { reply_markup: { inline_keyboard: [[{ text: t.openShop, web_app: { url } }]] } }
        : {},
    };
  }
}
