import { settingDefinitions } from '@lummi/contracts';
import type { FeedApi } from './feed-api';
import { reportsCredit } from './humo-text';
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

/**
 * The longest single sleep on a flood wait: under half of the smallest value the stale-heartbeat
 * setting may take (#36), so no wait of ours can, by itself, look like a dead feed. A longer wait
 * is slept in pieces (mtcute answers an early retry itself, without calling Telegram).
 */
export const FLOOD_SLEEP_CAP_SECONDS =
  Math.floor((settingDefinitions['payments.heartbeatStaleSeconds'].schema.minValue ?? 120) / 2) - 1;

export interface RelayOptions {
  telegram: TelegramPort;
  api: FeedApi;
  log: Logger;
  /** The one chat it reads: the Humo bot (production) or our test bot (ADR 0023). */
  listenChatId: number;
  /** USERBOT_REQUIRE_VERIFIED: the listened bot must carry Telegram's verified tick (production). */
  requireVerifiedBot?: boolean;
  /** "Every minute" (ADR 0014); #36 calls the feed down after `payments.heartbeatStaleSeconds`. */
  heartbeatIntervalMs?: number;
  /** Backoff between attempts of a post, a read or a lookup that failed: doubling, capped. */
  retry?: { firstMs: number; maxMs: number };
  /** The relay stopped for good and needs a person (dead session, wrong or unknown chat). */
  onParked?: (reason: string) => void;
}

export type RelayStatus = 'starting' | 'catching-up' | 'live' | 'parked' | 'stopped';

/** Thrown inside a queue to abandon the current task once parked or stopped. */
class Halted extends Error {}

/** The one log line of a userbot that stopped for good (the relay's and the start's). */
export function logParked(log: Logger, reason: string): void {
  log.error({ reason }, 'userbot stopped: it needs a person; no heartbeats until then');
}

/** A queue of async tasks run one at a time. */
class TaskQueue {
  private tail: Promise<void> = Promise.resolve();
  pending = 0;

  constructor(private readonly onIdle: () => void = () => undefined) {}

  run(task: () => Promise<void>): Promise<void> {
    this.pending++;
    const run = this.tail.then(async () => {
      try {
        await task();
      } catch (e) {
        if (!(e instanceof Halted)) throw e;
      } finally {
        this.pending--;
        if (this.pending === 0) this.onIdle();
      }
    });
    // A bug in a task must not wedge the queue; it surfaces as an unhandled rejection (main exits).
    this.tail = run.catch(() => undefined);
    return run;
  }

  get idle(): Promise<void> {
    return this.tail;
  }
}

/**
 * The Humo relay (ADR 0014, ADR 0035; spec Changes 2026-11-09 «For the userbot», 2026-11-11 #36 (7)).
 *
 * - At start it checks that the listened chat is a bot (and verified, when required).
 * - It reads only `listenChatId`, and there only what the bot sent (not the account's own
 *   messages, not service messages).
 * - Posts: every message goes to the API with its id, in id order, each retried until accepted
 *   before the next, since catch-up resumes after the highest stored id and a gap would never be
 *   filled. The API decides what a message is. Posts and catch-ups share one queue.
 * - Forwards: a ➕ the API had not seen before is then forwarded to «Поступления», on a queue of its
 *   own, so a flood wait or a refusal there holds back neither the posts nor the heartbeat.
 * - Catch-up: on start (after the API's last stored id) and after every reconnect (after the last
 *   id handled), the history is read before anything that arrived meanwhile.
 * - Heartbeat, on its own timer: "connected, session valid, caught up". Sent only when the history
 *   has been read, no post is waiting, the connection is up and Telegram answers a `getMe`.
 * - A dead session or a wrong or unreachable chat parks the relay: it stops, says why once, and
 *   waits for a person instead of a restart loop.
 */
export class HumoRelay {
  private readonly telegram: TelegramPort;
  private readonly api: FeedApi;
  private readonly log: Logger;
  private readonly listenChatId: number;
  private readonly heartbeatIntervalMs: number;
  private readonly retry: { firstMs: number; maxMs: number };

  private state: RelayStatus = 'starting';
  private reason: string | null = null;
  /** mtcute reports the connection up and done with its own update catch-up. */
  private connected = true;
  /** The history has been read since the last (re)connect: live updates are complete. */
  private inSync = false;
  private identityChecked = false;
  /** The highest id handled in order; the next catch-up reads after it. */
  private resumeAfter: number | null = null;
  private readonly seen = new Set<number>();
  /** Live messages that arrived while out of sync, handled after the history. */
  private buffer: ChatMessage[] = [];
  private readonly posts = new TaskQueue(() => {
    if (this.beatDue) void this.beat();
  });
  private readonly forwards = new TaskQueue();
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
  }

  get status(): RelayStatus {
    return this.state;
  }

  /** Why it parked; null unless parked. */
  get parkReason(): string | null {
    return this.reason;
  }

  /** Subscribe, catch up, start the heartbeat. Resolves once the first catch-up is done (or parked). */
  start(): Promise<void> {
    this.telegram.onMessage(this.listenChatId, (m) => this.onMessage(m));
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

  /** What the bot sent in the listened chat (the adapter has already dropped other chats). */
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
    void this.posts.run(() => this.handle(m));
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

  // ---- posts and catch-up (one queue)

  private scheduleCatchUp(): Promise<void> {
    if (this.catchUpQueued) return this.posts.idle;
    this.catchUpQueued = true;
    this.inSync = false;
    return this.posts.run(async () => {
      this.catchUpQueued = false;
      if (this.halted) return;
      await this.catchUp();
    });
  }

  private async catchUp(): Promise<void> {
    this.state = 'catching-up';
    if (!this.identityChecked) await this.checkIdentity();
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

    if (!this.connected || this.halted) return; // dropped meanwhile: the next 'connected' catches up
    this.inSync = true;
    this.state = 'live';
    this.log.info({ after: from, upTo: this.resumeAfter }, 'caught up with the Humo chat');
    await this.beat();
  }

  /**
   * The listened chat must be a bot: the Humo bot, or our test bot outside production. With
   * USERBOT_REQUIRE_VERIFIED (production) it must also be verified by Telegram, so a look-alike
   * bot set by mistake cannot feed credits.
   */
  private async checkIdentity(): Promise<void> {
    const who = await this.persist('check the listened chat', () =>
      this.telegram.chatIdentity(this.listenChatId),
    );
    const id = `USERBOT_LISTEN_CHAT_ID ${this.listenChatId}`;
    if (!who.isBot) {
      this.park(
        `${id} is not a bot: the userbot reads only a bot's chat (the Humo bot, or the test bot)`,
      );
    }
    if (this.o.requireVerifiedBot && !who.isVerified) {
      this.park(
        `${id} is a bot without Telegram's verified tick, and USERBOT_REQUIRE_VERIFIED is on: check with whois.ts that it is the official Humo bot`,
      );
    }
    this.identityChecked = true;
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

  /** Post (retried until accepted); a ➕ the API had not seen before then goes to the forwards. */
  private async handle(m: ChatMessage): Promise<void> {
    if (this.seen.has(m.id)) return;
    const res = await this.post(m);
    this.remember(m.id);
    // A duplicate was posted, and forwarded, by an earlier run: forwarding it again would show the
    // staff the same money twice.
    if (!res.duplicate && reportsCredit(m.text)) void this.forwards.run(() => this.forward(m));
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

  private async post(m: ChatMessage) {
    for (let attempt = 1; ; attempt++) {
      if (this.halted) throw new Halted();
      try {
        const res = await this.api.postMessage(m.id, m.text);
        this.log.info(
          { messageId: m.id, outcome: res.outcome, duplicate: res.duplicate },
          'humo message posted',
        );
        return res;
      } catch (e) {
        const delay = this.retryDelayMs(e, attempt);
        this.log.warn(
          { messageId: m.id, attempt, retryInMs: delay, error: describeError(e) },
          'humo message not accepted yet; retrying (nothing after it is posted meanwhile)',
        );
        await sleep(delay);
      }
    }
  }

  // ---- forwards (their own queue)

  private async forward(m: ChatMessage): Promise<void> {
    if (this.halted) return;
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
    for (let attempt = 1; ; attempt++) {
      if (this.halted) return;
      try {
        await this.telegram.forward(this.listenChatId, m.id, to);
        this.log.info({ messageId: m.id, toChatId: to.chatId, topicId: to.topicId }, 'forwarded');
        return;
      } catch (e) {
        this.parkIfDead(e);
        const wait = floodWaitSeconds(e);
        // A forward waits out one short flood wait at most; a longer one costs only the forward.
        if (wait !== null && wait < FLOOD_SLEEP_CAP_SECONDS && attempt < 3) {
          this.log.warn({ messageId: m.id, waitSeconds: wait }, 'forward flood wait; waiting');
          await sleep(this.retryDelayMs(e, attempt));
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

  // ---- retrying

  /**
   * Run a step that must succeed: wait out flood waits, retry other failures with backoff, park on
   * a dead session or a chat the account cannot see.
   */
  private async persist<T>(what: string, step: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      if (this.halted) throw new Halted();
      try {
        return await step();
      } catch (e) {
        if (e instanceof Halted) throw e; // parked inside the step
        this.parkIfDead(e);
        if (e instanceof PeerUnknownError) {
          this.park(
            `the listened chat ${this.listenChatId} is not among the account's chats: check USERBOT_LISTEN_CHAT_ID, and that this account has started that bot`,
          );
        }
        const delay = this.retryDelayMs(e, attempt);
        this.log.warn(
          { attempt, retryInMs: delay, error: describeError(e) },
          `could not ${what}; retrying`,
        );
        await sleep(delay);
      }
    }
  }

  /** The one wait between attempts: Telegram's flood wait (capped, see above), else backoff. */
  private retryDelayMs(e: unknown, attempt: number): number {
    const wait = floodWaitSeconds(e);
    if (wait !== null) return Math.min(wait + 1, FLOOD_SLEEP_CAP_SECONDS) * 1000;
    return Math.min(this.retry.firstMs * 2 ** (attempt - 1), this.retry.maxMs);
  }

  // ---- heartbeat (its own timer)

  private tick(): void {
    if (this.halted || !this.inSync || !this.connected) return;
    // A post in flight: we are not caught up until it is through; beat right after it.
    if (this.posts.pending > 0) this.beatDue = true;
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
    this.reason = reason;
    clearInterval(this.timer);
    logParked(this.log, reason);
    this.o.onParked?.(reason);
  }
}

export const deadSessionReason = (e: unknown) =>
  `the Telegram session is no longer valid (${describeError(e)}): log in again with the login CLI (docs/run-guide.md → Userbot)`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
