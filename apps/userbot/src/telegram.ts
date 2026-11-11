import { MtPeerNotFoundError, tl } from '@mtcute/node';

/**
 * The userbot's view of Telegram (ADR 0014). `MtcuteClient` is the part of mtcute's
 * `TelegramClient` it uses: the real client satisfies it (checked in `mtcute-client.ts`), and the
 * tests drive the same code with a fake one. Nothing here reads a chat other than the one asked for.
 */

export type ConnectionState = 'offline' | 'connecting' | 'updating' | 'connected';

/** The fields of an mtcute `Message` the userbot reads. */
export interface MtMessage {
  readonly id: number;
  readonly text: string;
  readonly isOutgoing: boolean;
  readonly isService: boolean;
  readonly chat: { readonly id: number };
  readonly sender: { readonly id: number };
}

interface Subscribable<T> {
  add(listener: (value: T) => void): void;
}

/** History read oldest first, starting after a message id (mtcute: `reverse` with an offset). */
export interface HistoryAfterParams {
  reverse: true;
  offset: { id: number; date: number };
  minId: number;
  chunkSize: number;
}

export interface MtcuteClient {
  iterHistory(chatId: number, params: HistoryAfterParams): AsyncIterable<MtMessage>;
  getHistory(chatId: number, params: { limit: number }): Promise<ArrayLike<MtMessage>>;
  forwardMessagesById(params: {
    fromChatId: number;
    messages: number[];
    toChatId: number;
    toThreadId?: number;
  }): Promise<unknown>;
  iterDialogs(params: {
    archived: 'keep';
    limit: number;
  }): AsyncIterable<{ readonly peer: { readonly id: number } }>;
  /** One cheap call that needs a valid session (users.getUsers of self). */
  getMe(): Promise<{ readonly id: number }>;
  readonly onNewMessage: Subscribable<MtMessage>;
  readonly onConnectionState: Subscribable<ConnectionState>;
  /** Errors mtcute meets in the background (updates loop, reconnects). */
  readonly onError: Subscribable<Error>;
}

/** A message as the relay handles it. */
export interface ChatMessage {
  id: number;
  chatId: number;
  senderId: number;
  outgoing: boolean;
  service: boolean;
  /** The text exactly as received. Personal data: posted to the API, never logged. */
  text: string;
}

export interface ForwardTarget {
  chatId: number;
  /** The forum topic; null forwards to the group's general chat. */
  topicId: number | null;
}

/** What the relay needs from Telegram. */
export interface TelegramPort {
  /** Messages of the chat with an id above `afterId`, oldest first. */
  historyAfter(chatId: number, afterId: number): AsyncIterable<ChatMessage>;
  /** The id of the newest message in the chat; null when it is empty. */
  newestMessageId(chatId: number): Promise<number | null>;
  /** Forward one message as is (staff see the original sender and text). */
  forward(fromChatId: number, messageId: number, to: ForwardTarget): Promise<void>;
  /** Throws unless Telegram answers a request that needs the session (dead session, no link). */
  probe(): Promise<void>;
  onMessage(listener: (message: ChatMessage) => void): void;
  onConnectionState(listener: (state: ConnectionState) => void): void;
  onError(listener: (error: Error) => void): void;
}

/** The chat is not among the account's chats, so the userbot cannot address it. */
export class PeerUnknownError extends Error {
  override name = 'PeerUnknownError';
  constructor(readonly chatIds: number[]) {
    super(`chat ${chatIds.join(' or ')} is not among the account's chats`);
  }
}

function toChatMessage(m: MtMessage): ChatMessage {
  return {
    id: m.id,
    chatId: m.chat.id,
    senderId: m.sender.id,
    outgoing: m.isOutgoing,
    service: m.isService,
    text: m.text,
  };
}

/**
 * The adapter over mtcute. The session lives in memory only (the encrypted string is the one copy at
 * rest), so after a start mtcute knows no chat's access hash yet: the first call that needs a chat
 * it cannot resolve looks it up among the account's dialogs, once, then retries.
 */
export class MtcuteTelegram implements TelegramPort {
  /** Chats a dialog scan found: mtcute has them cached from then on. */
  private readonly found = new Set<number>();
  private readonly notFoundUntil = new Map<number, number>();

  constructor(
    private readonly client: MtcuteClient,
    private readonly dialogScanLimit = 500,
    private readonly rescanAfterMs = 10 * 60_000,
  ) {}

  async *historyAfter(chatId: number, afterId: number): AsyncIterable<ChatMessage> {
    const params: HistoryAfterParams = {
      reverse: true,
      offset: { id: afterId + 1, date: 0 },
      minId: afterId,
      chunkSize: 100,
    };
    let iterator = this.client.iterHistory(chatId, params)[Symbol.asyncIterator]();
    let next = await this.withPeer(
      chatId,
      () => iterator.next(),
      () => {
        iterator = this.client.iterHistory(chatId, params)[Symbol.asyncIterator]();
      },
    );
    while (!next.done) {
      // `minId` already bounds the read; this keeps the contract even if a server returns more.
      if (next.value.id > afterId) yield toChatMessage(next.value);
      next = await iterator.next();
    }
  }

  async newestMessageId(chatId: number): Promise<number | null> {
    const page = await this.withPeer(chatId, () => this.client.getHistory(chatId, { limit: 1 }));
    return page[0]?.id ?? null;
  }

  async forward(fromChatId: number, messageId: number, to: ForwardTarget): Promise<void> {
    const send = () =>
      this.client.forwardMessagesById({
        fromChatId,
        messages: [messageId],
        toChatId: to.chatId,
        ...(to.topicId === null ? {} : { toThreadId: to.topicId }),
      });
    await this.withPeer([fromChatId, to.chatId], send);
  }

  async probe(): Promise<void> {
    await this.client.getMe();
  }

  onMessage(listener: (message: ChatMessage) => void): void {
    this.client.onNewMessage.add((m) => listener(toChatMessage(m)));
  }

  onError(listener: (error: Error) => void): void {
    this.client.onError.add(listener);
  }

  onConnectionState(listener: (state: ConnectionState) => void): void {
    this.client.onConnectionState.add(listener);
  }

  /**
   * Run `op`; if mtcute cannot resolve a chat, look the chats up among the dialogs and run it once
   * more. Still unresolved: PeerUnknownError (the account is not in that chat).
   */
  private async withPeer<T>(
    chatIds: number | number[],
    op: () => Promise<T>,
    beforeRetry?: () => void,
  ): Promise<T> {
    const ids = Array.isArray(chatIds) ? chatIds : [chatIds];
    try {
      return await op();
    } catch (e) {
      if (!(e instanceof MtPeerNotFoundError)) throw e;
    }
    await this.scanDialogs(ids);
    beforeRetry?.();
    try {
      return await op();
    } catch (e) {
      if (e instanceof MtPeerNotFoundError) throw new PeerUnknownError(ids);
      throw e;
    }
  }

  /**
   * Page through the dialogs (mtcute caches every chat it sees) until all are seen. A chat not found
   * is not looked for again for `rescanAfterMs`, so a group the account is not in costs one scan per
   * period, not one per ➕.
   */
  private async scanDialogs(chatIds: number[]): Promise<void> {
    const now = Date.now();
    const missing = new Set(
      chatIds.filter((id) => !this.found.has(id) && (this.notFoundUntil.get(id) ?? 0) <= now),
    );
    if (missing.size === 0) return;
    for await (const dialog of this.client.iterDialogs({
      archived: 'keep',
      limit: this.dialogScanLimit,
    })) {
      const id = dialog.peer.id;
      if (missing.delete(id)) {
        this.found.add(id);
        this.notFoundUntil.delete(id);
      }
      if (missing.size === 0) return;
    }
    for (const id of missing) this.notFoundUntil.set(id, now + this.rescanAfterMs);
  }
}

/** Seconds Telegram asked us to wait (FLOOD_WAIT_X and its kin), or null for any other error. */
export function floodWaitSeconds(e: unknown): number | null {
  if (!tl.RpcError.is(e)) return null;
  if (e.is('FLOOD_WAIT_%d')) return e.seconds;
  const m = /^(?:FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT|FLOOD_WAIT)_(\d+)$/.exec(e.text);
  return m ? Number(m[1]) : null;
}

/** The session is dead (logged out elsewhere, revoked, account gone): only a new login helps. */
const TERMINAL_AUTH = new Set([
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'AUTH_KEY_PERM_EMPTY',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
]);

export function isSessionDead(e: unknown): boolean {
  return tl.RpcError.is(e) && TERMINAL_AUTH.has(e.text);
}

/** A short, safe description of an error for the log: never a message body or a secret. */
export function describeError(e: unknown): string {
  if (tl.RpcError.is(e)) {
    // mtcute moves the number out of e.g. FLOOD_WAIT_30 into a field; put it back for the log.
    const arg = Object.values(e).find((v): v is number => typeof v === 'number' && v !== e.code);
    return `telegram ${e.code} ${arg === undefined ? e.text : e.text.replace('%d', String(arg))}`;
  }
  if (e instanceof Error) {
    const code =
      (e as { code?: unknown }).code ?? (e.cause as { code?: unknown } | undefined)?.code;
    // Our own error classes carry safe messages; anything else is named only.
    const safe = ['FeedApiError', 'PeerUnknownError', 'SessionFileError'].includes(e.name);
    return [e.name, typeof code === 'string' ? code : null, safe ? e.message : null]
      .filter(Boolean)
      .join(' ');
  }
  return typeof e;
}
