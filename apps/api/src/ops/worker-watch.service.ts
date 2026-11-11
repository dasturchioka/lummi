import { workerHeartbeat, type Db } from '@lummi/db';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Edges, OutboundMessage } from '../edges';
import { describeError } from '../logging/describe-error';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';

const CHECK_EVERY_MS = 60_000;

/**
 * The worker beats once per tick into `worker_heartbeat`; the API process watches it (ADR 0034).
 * After `ops.workerSilentMinutes` without a beat the owner (DMs and the «Системные» topic) and the
 * developer get one alert per outage, and one more when the beat returns.
 *
 * The alert is sent straight to Telegram, not through the outbox: the outbox is delivered by the
 * very worker that is down. Silence is measured from the later of the last beat and this process's
 * own start, so a deploy that restarts both does not alert for the gap before the API came up.
 */
@Injectable()
export class WorkerWatch implements OnApplicationShutdown {
  private readonly log = new Logger('WorkerWatch');
  private readonly startedAt: Date;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {
    this.startedAt = edges.clock.now();
  }

  /** The worker's side: stamp "alive now". */
  async beat(): Promise<void> {
    const now = this.edges.clock.now();
    await this.db
      .insert(workerHeartbeat)
      .values({ seenAt: now })
      .onConflictDoUpdate({ target: workerHeartbeat.id, set: { seenAt: now } });
  }

  /** The API's side: check every minute, from `main.ts` only (a test app calls `check()` itself). */
  start(): void {
    this.timer = setInterval(() => {
      this.check().catch((e: unknown) => this.log.error(`check failed: ${describeError(e)}`));
    }, CHECK_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One look at the heartbeat; alerts on the edge (silent, back), never on every look. */
  async check(): Promise<void> {
    const now = this.edges.clock.now();
    const limitMs = (await this.settings.get('ops.workerSilentMinutes')) * 60_000;
    await this.db.transaction(async (tx) => {
      await tx.insert(workerHeartbeat).values({ seenAt: now }).onConflictDoNothing();
      const [row] = await tx.select().from(workerHeartbeat).for('update');
      if (!row) return;
      const since = Math.max(row.seenAt.getTime(), this.startedAt.getTime());
      const silentMs = now.getTime() - since;
      const silent = silentMs > limitMs;
      const minutes = Math.floor(silentMs / 60_000);
      if (silent && !row.outageAlertedAt) {
        await this.notify(
          `Фоновый сервис (worker) молчит уже ${minutes} мин. Заказы принимаются, но сообщения, рассылки и таймеры не работают. Проверьте сервер.`,
        );
        await tx.update(workerHeartbeat).set({ outageAlertedAt: now });
      } else if (!silent && row.outageAlertedAt) {
        const outageMin = Math.floor((now.getTime() - row.outageAlertedAt.getTime()) / 60_000);
        await this.notify(
          `Фоновый сервис (worker) снова работает. Тревога была ${outageMin} мин назад.`,
        );
        await tx.update(workerHeartbeat).set({ outageAlertedAt: null });
      }
    });
  }

  /** Owner (DMs and the «Системные» topic) plus the developer; a failed send to one never blocks the rest. */
  private async notify(text: string): Promise<void> {
    const s = await Promise.all([
      this.settings.get('bot.alertRecipients'),
      this.settings.get('ops.developerChatId'),
      this.settings.get('bot.groupChatId'),
      this.settings.get('bot.topics'),
    ]);
    const [recipients, developer, group, topics] = s;
    const targets: OutboundMessage[] = [];
    if (group !== null) targets.push({ chatId: group, threadId: topics.system, text });
    const dms = new Set(recipients);
    if (developer !== null) dms.add(developer);
    for (const chatId of dms) targets.push({ chatId, text });
    if (targets.length === 0) {
      this.log.warn(`not sent, set bot.alertRecipients or ops.developerChatId: ${text}`);
      return;
    }
    const results = await Promise.allSettled(targets.map((m) => this.edges.telegram.send(m)));
    const failed = results.filter((r) => r.status === 'rejected');
    for (const r of failed) this.log.warn(`alert send failed: ${describeError(r.reason)}`);
    // Nothing got through: throw, so the marker stays unset and the next look tries again.
    if (failed.length === targets.length) throw new Error('worker alert reached nobody');
  }
}
