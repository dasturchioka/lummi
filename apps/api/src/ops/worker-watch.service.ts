import { and, eq, isNull, workerHeartbeat, type Db } from '@lummi/db';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Edges } from '../edges';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { OpsNotifier, everyMinute } from './ops-notifier.service';

type Claim = { kind: 'down'; at: Date; silentMs: number } | { kind: 'up'; was: Date; now: Date };

/**
 * The worker beats once per tick into `worker_heartbeat`; the API process watches it (ADR 0036).
 * After `ops.workerSilentSeconds` without a beat the owner and the developer get one alert per
 * outage, and one more when the worker is back.
 *
 * Each alert is first **claimed** with a short transaction (the marker `outage_alerted_at`), then
 * sent after the commit, so a slow Telegram never holds the heartbeat row locked and a worker's
 * `beat()` is never blocked. If every send failed the claim is undone and the next look retries.
 * "Back" means a beat newer than the alert (`seen_at > outage_alerted_at`): an API restart, or a
 * second API instance, never reports a recovery while the worker is still dead. Silence is
 * measured from the later of the last beat and this process's own start, so the gap of a deploy
 * does not raise the first alert.
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
    @Inject(OpsNotifier) private readonly notifier: OpsNotifier,
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

  /** The API's side: look every minute, from `main.ts` only (a test app calls `check()` itself). */
  start(): void {
    this.timer = everyMinute(() => this.check(), this.log);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One look at the heartbeat; alerts on the edge (silent, back), never on every look. */
  async check(): Promise<void> {
    const claim = await this.claim();
    if (!claim) return;
    try {
      await this.notifier.notify(
        claim.kind === 'down'
          ? `Фоновый сервис (worker) молчит уже ${Math.floor(claim.silentMs / 60_000)} мин. Заказы принимаются, но сообщения, рассылки и таймеры не работают. Проверьте сервер.`
          : `Фоновый сервис (worker) снова работает. Тревога была ${Math.floor((claim.now.getTime() - claim.was.getTime()) / 60_000)} мин назад.`,
      );
    } catch (e) {
      // Nothing got through: undo the claim, the next look tries again.
      if (claim.kind === 'down') {
        await this.db
          .update(workerHeartbeat)
          .set({ outageAlertedAt: null })
          .where(eq(workerHeartbeat.outageAlertedAt, claim.at));
      } else {
        await this.db
          .update(workerHeartbeat)
          .set({ outageAlertedAt: claim.was })
          .where(isNull(workerHeartbeat.outageAlertedAt));
      }
      throw e;
    }
  }

  /** The decision and its marker in one short transaction; no network in here. */
  private async claim(): Promise<Claim | null> {
    const now = this.edges.clock.now();
    const limitMs = (await this.settings.get('ops.workerSilentSeconds')) * 1000;
    return this.db.transaction(async (tx) => {
      await tx.insert(workerHeartbeat).values({ seenAt: now }).onConflictDoNothing();
      const [row] = await tx.select().from(workerHeartbeat).for('update');
      if (!row) return null;
      const silentMs = now.getTime() - Math.max(row.seenAt.getTime(), this.startedAt.getTime());
      if (!row.outageAlertedAt) {
        if (silentMs <= limitMs) return null;
        await tx
          .update(workerHeartbeat)
          .set({ outageAlertedAt: now })
          .where(eq(workerHeartbeat.id, true));
        return { kind: 'down', at: now, silentMs };
      }
      if (row.seenAt > row.outageAlertedAt && silentMs <= limitMs) {
        await tx
          .update(workerHeartbeat)
          .set({ outageAlertedAt: null })
          .where(and(eq(workerHeartbeat.id, true)));
        return { kind: 'up', was: row.outageAlertedAt, now };
      }
      return null;
    });
  }
}
