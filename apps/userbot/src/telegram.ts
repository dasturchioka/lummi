import { getMarkedPeerId, MtPeerNotFoundError, tl } from '@mtcute/node';

/**
 * The userbot's view of Telegram (ADR 0014). `MtcuteClient` is the part of mtcute's
 * `TelegramClient` it uses: the real client satisfies it (checked in `mtcute-client.ts`), and the
 * tests drive the same code with a fake one. Nothing here reads a chat other than the one asked for.
 */

export type ConnectionState = 'offline' | 'connecting' | 'updating' | 'connected';

/**
 * The raw TL message under an mtcute `Message`, as far as the userbot reads it. Reading the raw
 * fields, not `Message.chat` / `.sender`, never needs mtcute's peer cache, and lets the chat id be
 * checked before anything else of a message is touched.
 */
export interface MtRawMessage {
  readonly _: 'message' | 'messageService';
  readonly peerId: tl.TypePeer;
  readonly fromId?: tl.TypePeer;
  readonly out?: boolean;
  readonly message?: string;
}

/** An mtcute `Message`, as far as the userbot reads it. */
export interface MtMessage {
  readonly id: number;
  readonly raw: MtRawMessage;
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
  getUser(userId: number): Promise<{ readonly isBot: boolean; readonly isVerified: boolean }>;
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
  /** Whether the chat is a bot, and verified by Telegram (the listened chat's identity check). */
  chatIdentity(chatId: number): Promise<{ isBot: boolean; isVerified: boolean }>;
  /** Throws unless Telegram answers a request that needs the session (dead session, no link). */
  probe(): Promise<void>;
  /** New messages of one chat; any other chat's are dropped on their chat id, unread. */
  onMessage(chatId: number, listener: (message: ChatMessage) => void): void;
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

const chatIdOf = (m: MtMessage): number => getMarkedPeerId(m.raw.peerId);

/** Only for a message already known to be from `chatId`. */
function toChatMessage(m: MtMessage, chatId: number): ChatMessage {
  const { raw } = m;
  return {
    id: m.id,
    chatId,
    // In a private chat an incoming message may carry no sender: the chat is the sender.
    senderId: raw.fromId ? getMarkedPeerId(raw.fromId) : chatId,
    outgoing: raw.out === true,
    service: raw._ === 'messageService',
    text: raw._ === 'message' ? (raw.message ?? '') : '',
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
      if (next.value.id > afterId && chatIdOf(next.value) === chatId) {
        yield toChatMessage(next.value, chatId);
      }
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

  async chatIdentity(chatId: number): Promise<{ isBot: boolean; isVerified: boolean }> {
    const user = await this.withPeer(chatId, () => this.client.getUser(chatId));
    return { isBot: user.isBot, isVerified: user.isVerified };
  }

  async probe(): Promise<void> {
    await this.client.getMe();
  }

  onMessage(chatId: number, listener: (message: ChatMessage) => void): void {
    this.client.onNewMessage.add((m) => {
      // The account's other chats are none of our business: nothing past the chat id is read.
      if (chatIdOf(m) !== chatId) return;
      listener(toChatMessage(m, chatId));
    });
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

/** Named dead-session errors that are not a 401 (every 401 is one: the request was not authorized). */
const TERMINAL_AUTH = new Set([
  'AUTH_KEY_DUPLICATED', // 406: the same key used from two places; Telegram dropped it
  'AUTH_KEY_INVALID',
  'SESSION_EXPIRED',
]);

/**
 * The session is dead (ended under Devices, logged out elsewhere, key duplicated, account gone):
 * only a new login helps, and retrying would only keep calling Telegram with a dead key.
 */
export function isSessionDead(e: unknown): boolean {
  return tl.RpcError.is(e) && (e.code === 401 || TERMINAL_AUTH.has(e.text));
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
