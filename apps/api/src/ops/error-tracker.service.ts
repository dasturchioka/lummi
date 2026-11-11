import { errorEvents, sql, type Db } from '@lummi/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Edges } from '../edges';
import { describeError } from '../logging/describe-error';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { signError } from './fingerprint';

/**
 * Errors in our own table, no foreign tracker (ADR 0034). The first occurrence of a fingerprint
 * pings the developer's chat through the outbox, in the same transaction as the row; a repeat only
 * counts. Recording never throws: the error being recorded is already one too many.
 */
@Injectable()
export class ErrorTracker {
  private readonly log = new Logger('ErrorTracker');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** `route` is already normalised (`GET /orders/:id`, `worker:<sweep>`): no ids, no query string. */
  async record(error: unknown, route: string): Promise<void> {
    try {
      const sig = signError(error, route);
      const now = this.edges.clock.now();
      await this.outbox.withTx(async (tx) => {
        const [row] = await tx
          .insert(errorEvents)
          .values({
            fingerprint: sig.fingerprint,
            errorClass: sig.errorClass,
            route: sig.route,
            frames: sig.frames,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .onConflictDoUpdate({
            target: errorEvents.fingerprint,
            set: { count: sql`${errorEvents.count} + 1`, lastSeenAt: now },
          })
          // xmax is 0 on a row this statement inserted
          .returning({ isNew: sql<boolean>`(xmax = 0)` });
        if (!row?.isNew) return;
        const chatId = await this.settings.get('ops.developerChatId', tx);
        if (chatId === null) {
          this.log.warn(
            `new error ${sig.errorClass} on ${sig.route}: set ops.developerChatId to be pinged`,
          );
          return;
        }
        const text = [
          'Новая ошибка на сервере',
          `Класс: ${sig.errorClass}`,
          `Маршрут: ${sig.route}`,
          ...(sig.frames ? [`Где: ${sig.frames}`] : []),
          `Отпечаток: ${sig.fingerprint.slice(0, 8)}`,
        ].join('\n');
        await this.outbox.enqueue(tx, { chatId, text });
      });
    } catch (e) {
      this.log.error(`could not record an error: ${describeError(e)}`);
    }
  }
}
