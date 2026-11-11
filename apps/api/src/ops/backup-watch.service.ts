import { backupStatus, eq, type Db } from '@lummi/db';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Edges } from '../edges';
import { describeError } from '../logging/describe-error';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { OpsNotifier, everyMinute } from './ops-notifier.service';

const SKIP_ALERT_EVERY_MS = 24 * 3600 * 1000;

/**
 * The host's backup script reports each finished run to `POST /internal/backup/report` (ADR 0035).
 * A run that skipped a step (no second-copy target, no userbot session) is alerted at most once a
 * day; no report for `ops.backupStaleSeconds` is alerted once per gap, and the next report ends the
 * gap. A failed run is alerted by the host itself (`OnFailure=`); this watch covers the failures
 * nothing on the host can report: a dead timer, a host that was down at 03:00, a stuck script.
 * Same claim-then-send shape as `WorkerWatch`: no Telegram call inside a transaction.
 */
@Injectable()
export class BackupWatch implements OnApplicationShutdown {
  private readonly log = new Logger('BackupWatch');
  private readonly startedAt: Date;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OpsNotifier) private readonly notifier: OpsNotifier,
  ) {
    this.startedAt = edges.clock.now();
  }

  start(): void {
    this.timer = everyMinute(() => this.check(), this.log);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** A run finished. `skipped` names the steps it could not do. */
  async report(skipped: string[]): Promise<void> {
    const now = this.edges.clock.now();
    const alert = await this.db.transaction(async (tx) => {
      await tx.insert(backupStatus).values({ lastSuccessAt: now }).onConflictDoNothing();
      const [row] = await tx.select().from(backupStatus).for('update');
      const due =
        skipped.length > 0 &&
        (!row?.skipAlertedAt || now.getTime() - row.skipAlertedAt.getTime() > SKIP_ALERT_EVERY_MS);
      await tx
        .update(backupStatus)
        .set({ lastSuccessAt: now, staleAlertedAt: null, ...(due ? { skipAlertedAt: now } : {}) })
        .where(eq(backupStatus.id, true));
      return due ? { was: row?.skipAlertedAt ?? null } : null;
    });
    if (!alert) return;
    try {
      await this.notifier.notify(
        `Бэкап LUMMI прошёл не полностью, пропущено: ${skipped.join(', ')}. Проверьте настройки бэкапа (run-guide).`,
      );
    } catch (e) {
      this.log.warn(`skip alert not sent: ${describeError(e)}`);
      await this.db
        .update(backupStatus)
        .set({ skipAlertedAt: alert.was })
        .where(eq(backupStatus.id, true));
    }
  }

  /** One look: alert once when the last report is older than the limit. */
  async check(): Promise<void> {
    const now = this.edges.clock.now();
    const limitMs = (await this.settings.get('ops.backupStaleSeconds')) * 1000;
    const hours = await this.db.transaction(async (tx) => {
      await tx.insert(backupStatus).values({}).onConflictDoNothing();
      const [row] = await tx.select().from(backupStatus).for('update');
      if (!row || row.staleAlertedAt) return null;
      const since = Math.max(row.lastSuccessAt?.getTime() ?? 0, this.startedAt.getTime());
      if (now.getTime() - since <= limitMs) return null;
      await tx.update(backupStatus).set({ staleAlertedAt: now }).where(eq(backupStatus.id, true));
      return Math.floor((now.getTime() - since) / 3_600_000);
    });
    if (hours === null) return;
    try {
      await this.notifier.notify(
        `Бэкап LUMMI не отчитывался уже ${hours} ч. Проверьте сервер: systemctl status lummi-backup.`,
      );
    } catch (e) {
      await this.db
        .update(backupStatus)
        .set({ staleAlertedAt: null })
        .where(eq(backupStatus.staleAlertedAt, now));
      throw e;
    }
  }
}
