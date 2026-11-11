import type { FeedApi } from './feed-api';
import { isCreditNotification } from './humo-text';
import type { Logger } from './logger';
import {
  describeError,
  floodWaitSeconds,
  isSessionDead,
  PeerUnknownError,
  type ChatMessage,
  type ConnectionState,
  type TelegramPort,
} from './telegram';

export interface RelayOptions {
  telegram: TelegramPort;
  api: FeedApi;
  log: Logger;
  /** The one chat it reads: the Humo bot (production) or our test bot (ADR 0023). */
  listenChatId: number;
  /** "Every minute" (ADR 0014); #36 calls the feed down after `payments.heartbeatStaleSeconds`. */
  heartbeatIntervalMs?: number;
  /** Backoff between attempts of a post, a read or a lookup that failed: doubling, capped. */
  retry?: { firstMs: number; maxMs: number };
  /** A forward flood wait up to this is waited out; a longer one skips that forward. */
  forwardFloodCapSeconds?: number;
  /** The relay stopped for good and needs a person (dead session, unknown chat). */
  onParked?: (reason: string) => void;
}

export type RelayStatus = 'starting' | 'catching-up' | 'live' | 'parked' | 'stopped';

/** Thrown inside the work chain to abandon the current task once parked or stopped. */
class Halted extends Error {}

/**
 * The Humo relay (ADR 0014; spec Changes 2026-11-09 «For the userbot», 2026-11-11 #36 (7)).
 *
 * - Reads only `listenChatId`, and only the messages the other side sent (not the account's own,
 *   not service messages).
 * - Every message is posted to the API with its id, in id order, each retried until accepted before
 *   the next: catch-up after a restart resumes after the highest stored id, so a gap would never be
 *   filled. The API decides what a message is.
 * - A ➕ is then forwarded to «Поступления». The forward is best effort: a refusal is logged and
 *   never holds the feed back, since the credit is already recorded.
 * - Catch-up: on start (after the API's last stored id) and after every reconnect (after the last id
 *   handled), the chat history is read before anything that arrived meanwhile.
 * - The heartbeat means "connected and caught up": it is sent only when the history has been read,
 *   nothing is waiting to be posted, and the connection is up.
 * - A dead session or a chat the account cannot see parks the relay: it stops, says why once, and
 *   waits for a person, instead of a restart loop.
 *
 * All work runs on one chain, one task at a time, so the order above holds.
 */
export class HumoRelay {
  private readonly telegram: TelegramPort;
  private readonly api: FeedApi;
  private readonly log: Logger;
  private readonly listenChatId: number;
  private readonly heartbeatIntervalMs: number;
  private readonly retry: { firstMs: number; maxMs: number };
  private readonly forwardFloodCapSeconds: number;

  private state: RelayStatus = 'starting';
  /** mtcute reports the connection up and done with its own update catch-up. */
  private connected = true;
  /** The history has been read since the last (re)connect: live updates are complete. */
  private inSync = false;
  /** The highest id handled in order; the next catch-up reads after it. */
  private resumeAfter: number | null = null;
  private readonly seen = new Set<number>();
  /** Live messages that arrived while out of sync, handled after the history. */
  private buffer: ChatMessage[] = [];
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private catchUpQueued = false;
  private beatDue = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly o: RelayOptions) {
    this.telegram = o.telegram;
    this.api = o.api;
    this.log = o.log;
    this.listenChatId = o.listenChatId;
    this.heartbeatIntervalMs = o.heartbeatIntervalMs ?? 60_000;
    this.retry = o.retry ?? { firstMs: 1_000, maxMs: 60_000 };
    this.forwardFloodCapSeconds = o.forwardFloodCapSeconds ?? 120;
  }

  get status(): RelayStatus {
    return this.state;
  }

  /** Subscribe, catch up, start the heartbeat. Resolves once the first catch-up is done (or parked). */
  start(): Promise<void> {
    this.telegram.onMessage((m) => this.onMessage(m));
    this.telegram.onConnectionState((s) => this.onConnectionState(s));
    this.telegram.onError((e) => this.onTelegramError(e));
    this.timer = setInterval(() => this.tick(), this.heartbeatIntervalMs);
    return this.scheduleCatchUp();
  }

  stop(): void {
    if (this.state !== 'parked') this.state = 'stopped';
    clearInterval(this.timer);
  }

  private get halted(): boolean {
    return this.state === 'parked' || this.state === 'stopped';
  }

  // ---- input

  private accepts(m: ChatMessage): boolean {
    return (
      m.chatId === this.listenChatId &&
      m.senderId === this.listenChatId &&
      !m.outgoing &&
      !m.service
    );
  }

  private onMessage(m: ChatMessage): void {
    if (this.halted || !this.accepts(m)) return;
    if (!this.inSync) {
      this.buffer.push(m);
      return;
    }
    void this.enqueue(() => this.handle(m));
  }

  private onConnectionState(state: ConnectionState): void {
    if (this.halted) return;
    if (state !== 'connected') {
      // Offline, reconnecting, or mtcute still fetching what it missed: updates may be incomplete.
      if (this.connected) {
        this.log[state === 'updating' ? 'info' : 'warn'](
          { state },
          'telegram not in sync; heartbeat paused until the history is read again',
        );
      }
      this.connected = false;
      this.inSync = false;
      return;
    }
    const wasDown = !this.connected;
    this.connected = true;
    if (wasDown || !this.inSync) void this.scheduleCatchUp();
  }

  /** mtcute's background errors: a dead session stops the relay; the rest is only logged. */
  private onTelegramError(e: unknown): void {
    if (this.halted) return;
    if (isSessionDead(e)) this.markParked(deadSessionReason(e));
    else this.log.warn({ error: describeError(e) }, 'telegram client error');
  }

  // ---- the work chain

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.pending++;
    const run = this.chain.then(async () => {
      try {
        if (!this.halted) await task();
      } catch (e) {
        if (!(e instanceof Halted)) throw e;
      } finally {
        this.pending--;
        if (this.beatDue && this.pending === 0) void this.beat();
      }
    });
    // A bug in a task must not wedge the chain; it surfaces as an unhandled rejection (main exits).
    this.chain = run.catch(() => undefined);
    return run;
  }

  private scheduleCatchUp(): Promise<void> {
    if (this.catchUpQueued) return this.chain;
    this.catchUpQueued = true;
    this.inSync = false;
    return this.enqueue(async () => {
      this.catchUpQueued = false;
      await this.catchUp();
    });
  }

  private async catchUp(): Promise<void> {
    this.state = 'catching-up';
    if (this.resumeAfter === null) this.resumeAfter = await this.startingPoint();

    const from = this.resumeAfter;
    await this.persist('read the Humo chat history', async () => {
      for await (const m of this.telegram.historyAfter(this.listenChatId, this.resumeAfter!)) {
        if (this.accepts(m)) await this.handle(m);
      }
    });
    // What arrived while the history was read, oldest first; `seen` drops the overlap.
    while (this.buffer.length > 0) {
      const batch = this.buffer.sort((a, b) => a.id - b.id);
      this.buffer = [];
      for (const m of batch) await this.handle(m);
    }

    if (!this.connected) return; // dropped meanwhile: the next 'connected' catches up again
    this.inSync = true;
    this.state = 'live';
    this.log.info({ after: from, upTo: this.resumeAfter }, 'caught up with the Humo chat');
    await this.beat();
  }

  /** Where the first catch-up starts: after the API's last stored id, or after the newest message. */
  private async startingPoint(): Promise<number> {
    const last = await this.persist('ask the API for the last stored message', () =>
      this.api.lastMessageId(),
    );
    if (last !== null) return last;
    const newest = await this.persist('find the newest message of the Humo chat', () =>
      this.telegram.newestMessageId(this.listenChatId),
    );
    this.log.warn(
      { after: newest ?? 0 },
      'nothing stored yet: starting after the newest message of the Humo chat; earlier history is not imported',
    );
    return newest ?? 0;
  }

  /** Post (retried until accepted), then forward a ➕. Each message once. */
  private async handle(m: ChatMessage): Promise<void> {
    if (this.seen.has(m.id)) return;
    await this.post(m);
    this.remember(m.id);
    if (isCreditNotification(m.text)) await this.forward(m);
  }

  private remember(id: number): void {
    this.seen.add(id);
    this.resumeAfter = Math.max(this.resumeAfter ?? 0, id);
    if (this.seen.size > 5_000) {
      const keep = [...this.seen].sort((a, b) => b - a).slice(0, 2_500);
      this.seen.clear();
      for (const k of keep) this.seen.add(k);
    }
  }

  private async post(m: ChatMessage): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      if (this.halted) throw new Halted();
      try {
        const res = await this.api.postMessage(m.id, m.text);
        this.log.info(
          { messageId: m.id, outcome: res.outcome, duplicate: res.duplicate },
          'humo message posted',
        );
        return;
      } catch (e) {
        const delay = this.backoff(attempt);
        this.log.warn(
          { messageId: m.id, attempt, retryInMs: delay, error: describeError(e) },
          'humo message not accepted yet; retrying (nothing after it is posted meanwhile)',
        );
        await sleep(delay);
      }
    }
  }

  private async forward(m: ChatMessage): Promise<void> {
    let target;
    try {
      target = await this.api.forwardTarget();
    } catch (e) {
      this.log.warn(
        { messageId: m.id, error: describeError(e) },
        'forward skipped: target unknown',
      );
      return;
    }
    if (target.chatId === null) {
      this.log.warn({ messageId: m.id }, 'forward skipped: bot.groupChatId is not set');
      return;
    }
    const to = { chatId: target.chatId, topicId: target.topicId };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.telegram.forward(this.listenChatId, m.id, to);
        this.log.info({ messageId: m.id, toChatId: to.chatId, topicId: to.topicId }, 'forwarded');
        return;
      } catch (e) {
        this.parkIfDead(e);
        const wait = floodWaitSeconds(e);
        if (wait !== null && wait <= this.forwardFloodCapSeconds && attempt < 3) {
          this.log.warn({ messageId: m.id, waitSeconds: wait }, 'forward flood wait; waiting');
          await sleep(wait * 1000 + 1000);
          continue;
        }
        this.log.warn(
          { messageId: m.id, error: describeError(e) },
          'forward failed; the message is recorded but not shown in «Поступления»',
        );
        return;
      }
    }
  }

  /**
   * Run a step that must succeed: wait out flood waits as Telegram says, retry other failures with
   * backoff, park on a dead session or an unknown chat.
   */
  private async persist<T>(what: string, step: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      if (this.halted) throw new Halted();
      try {
        return await step();
      } catch (e) {
        if (e instanceof Halted) throw e; // parked inside the step (e.g. a catch-up forward)
        this.parkIfDead(e);
        if (e instanceof PeerUnknownError) {
          this.park(
            `the listened chat ${this.listenChatId} is not among the account's chats: check USERBOT_LISTEN_CHAT_ID, and that this account has started that bot`,
          );
        }
        const wait = floodWaitSeconds(e);
        const delay = wait !== null ? wait * 1000 + 1000 : this.backoff(attempt);
        this.log.warn(
          { attempt, retryInMs: delay, error: describeError(e) },
          `could not ${what}; retrying`,
        );
        await sleep(delay);
      }
    }
  }

  private backoff(attempt: number): number {
    return Math.min(this.retry.firstMs * 2 ** (attempt - 1), this.retry.maxMs);
  }

  // ---- heartbeat

  private tick(): void {
    if (this.halted || !this.inSync || !this.connected) return;
    if (this.pending > 0) this.beatDue = true;
    else void this.beat();
  }

  /**
   * A heartbeat says "connected, session valid, caught up". A revoked session can leave the link
   * itself up, so Telegram is asked first (one `getMe` a minute).
   */
  private async beat(): Promise<void> {
    this.beatDue = false;
    if (this.halted || !this.inSync || !this.connected) return;
    try {
      await this.telegram.probe();
    } catch (e) {
      if (isSessionDead(e)) {
        this.markParked(deadSessionReason(e));
        return;
      }
      this.log.warn({ error: describeError(e) }, 'telegram did not answer; heartbeat skipped');
      return;
    }
    if (this.halted || !this.inSync || !this.connected) return;
    try {
      await this.api.heartbeat();
    } catch (e) {
      this.log.warn({ error: describeError(e) }, 'heartbeat not accepted; next tick tries again');
    }
  }

  // ---- stopping for good

  private parkIfDead(e: unknown): void {
    if (isSessionDead(e)) this.park(deadSessionReason(e));
  }

  private park(reason: string): never {
    this.markParked(reason);
    throw new Halted();
  }

  private markParked(reason: string): void {
    if (this.halted) return;
    this.state = 'parked';
    clearInterval(this.timer);
    this.log.error({ reason }, 'userbot stopped: it needs a person; no heartbeats until then');
    this.o.onParked?.(reason);
  }
}

const deadSessionReason = (e: unknown) =>
  `the Telegram session is no longer valid (${describeError(e)}): log in again with the login CLI (docs/run-guide.md → Userbot)`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
