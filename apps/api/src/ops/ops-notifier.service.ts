import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Edges, OutboundMessage } from '../edges';
import { describeError } from '../logging/describe-error';
import { SettingsService } from '../settings/settings.service';
import { EDGES } from '../tokens';

/**
 * Operational alerts sent straight to Telegram, not through the outbox: the outbox is delivered by
 * the worker, and these alerts are about the worker (or the host) being down. The owner's DMs, the
 * «Системные» topic and the developer; a failed send to one never blocks the rest.
 */
@Injectable()
export class OpsNotifier {
  private readonly log = new Logger('OpsNotifier');

  constructor(
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Resolves when at least one send went through, or when nobody is configured (logged). Throws when every send failed. */
  async notify(text: string): Promise<void> {
    const [recipients, developer, group, topics] = await Promise.all([
      this.settings.get('bot.alertRecipients'),
      this.settings.get('ops.developerChatId'),
      this.settings.get('bot.groupChatId'),
      this.settings.get('bot.topics'),
    ]);
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
    if (failed.length === targets.length) throw new Error('operational alert reached nobody');
  }
}

/** A timer that never overlaps itself: a slow check is not stacked under the next minute's. */
export function everyMinute(run: () => Promise<void>, log: Logger): ReturnType<typeof setInterval> {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    run()
      .catch((e: unknown) => log.error(`check failed: ${describeError(e)}`))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref();
  return timer;
}
