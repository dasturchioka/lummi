import { MtPeerNotFoundError, parseMarkedPeerId, tl } from '@mtcute/node';
import type {
  ConnectionState,
  HistoryAfterParams,
  MtcuteClient,
  MtMessage,
  MtRawMessage,
} from '../../src/telegram';

/** mtcute's `Emitter`, as far as the userbot uses it. */
export class FakeEmitter<T> {
  private listeners: ((value: T) => void)[] = [];
  add(listener: (value: T) => void): void {
    this.listeners.push(listener);
  }
  emit(value: T): void {
    for (const l of this.listeners) l(value);
  }
}

/** An RPC error exactly as mtcute builds it from Telegram's answer. */
export const rpcError = (code: number, text: string): Error =>
  tl.RpcError.fromTl({ errorCode: code, errorMessage: text });

/** A marked chat id (Bot API style) as the raw TL peer mtcute puts in `message.raw.peerId`. */
export function rawPeer(markedId: number): tl.TypePeer {
  const [type, bare] = parseMarkedPeerId(markedId);
  if (type === 'user') return { _: 'peerUser', userId: bare };
  if (type === 'channel') return { _: 'peerChannel', channelId: bare };
  return { _: 'peerChat', chatId: bare };
}

export interface FakeMessageOptions {
  id?: number;
  senderId?: number;
  outgoing?: boolean;
  service?: boolean;
  /**
   * Reading the sender or the text throws, like an mtcute message whose peer is not cached: proves
   * the userbot drops it on its chat id alone.
   */
  untouchable?: boolean;
}

export interface FakeUser {
  isBot: boolean;
  isVerified: boolean;
}

/**
 * A fake mtcute client for one personal account: chats with history, a peer cache that starts
 * empty like a fresh in-memory session, dialogs, users, forwards and update emitters. Messages have
 * mtcute's raw shape. Message ids are one sequence across the account's private chats, as in a real
 * user account. `events` is shared with the fake API, so tests can assert the order of posts,
 * forwards and heartbeats.
 */
export class FakeMtcute implements MtcuteClient {
  readonly onNewMessage = new FakeEmitter<MtMessage>();
  readonly onConnectionState = new FakeEmitter<ConnectionState>();
  readonly onError = new FakeEmitter<Error>();
  /** Chats mtcute can address without a lookup (its peer cache). */
  readonly cached = new Set<number>();
  /** The account's dialogs, newest first. */
  dialogs: number[] = [];
  /** What `getUser` answers; an id not here is a person. */
  readonly users = new Map<number, FakeUser>();
  readonly forwards: {
    fromChatId: number;
    messages: number[];
    toChatId: number;
    toThreadId?: number;
  }[] = [];
  readonly historyReads: { chatId: number; afterId: number }[] = [];
  /** Thrown, in order, by the next forwards / history reads / `getMe` probes. */
  readonly forwardErrors: unknown[] = [];
  readonly historyErrors: unknown[] = [];
  readonly probeErrors: unknown[] = [];
  dialogScans = 0;
  probes = 0;
  private readonly chats = new Map<number, MtMessage[]>();
  private nextId = 1000;

  constructor(private readonly events: string[] = []) {}

  /** A message lands in a chat without its update being delivered (missed while offline). */
  addHistory(chatId: number, text: string, o: FakeMessageOptions = {}): MtMessage {
    const id = o.id ?? ++this.nextId;
    this.nextId = Math.max(this.nextId, id);
    const raw: MtRawMessage = o.untouchable
      ? Object.defineProperties({ _: 'message', peerId: rawPeer(chatId) } as MtRawMessage, {
          message: { get: () => fail('text') },
          fromId: { get: () => fail('sender') },
          out: { get: () => fail('direction') },
        })
      : {
          _: o.service ? 'messageService' : 'message',
          peerId: rawPeer(chatId),
          ...(o.outgoing || o.senderId !== undefined ? { fromId: rawPeer(o.senderId ?? 1) } : {}),
          out: o.outgoing ?? false,
          ...(o.service ? {} : { message: text }),
        };
    const m: MtMessage = { id, raw };
    const chat = this.chats.get(chatId) ?? [];
    chat.push(m);
    chat.sort((a, b) => a.id - b.id);
    this.chats.set(chatId, chat);
    return m;
  }

  /** A message arrives and mtcute delivers it as a new-message update. */
  receive(chatId: number, text: string, o: FakeMessageOptions = {}): MtMessage {
    const m = this.addHistory(chatId, text, o);
    this.cached.add(chatId); // an update carries its chat
    this.onNewMessage.emit(m);
    return m;
  }

  setConnection(state: ConnectionState): void {
    this.onConnectionState.emit(state);
  }

  private require(chatId: number): void {
    if (!this.cached.has(chatId))
      throw new MtPeerNotFoundError(`Peer ${chatId} is not found in local cache`);
  }

  async *iterHistory(chatId: number, params: HistoryAfterParams): AsyncIterable<MtMessage> {
    this.require(chatId);
    if (params.offset.id !== params.minId + 1)
      throw new Error('fake: offset must start after minId');
    this.historyReads.push({ chatId, afterId: params.minId });
    const error = this.historyErrors.shift();
    if (error) throw error;
    for (const m of this.chats.get(chatId) ?? []) if (m.id > params.minId) yield m;
  }

  async getHistory(chatId: number, params: { limit: number }): Promise<MtMessage[]> {
    this.require(chatId);
    return (this.chats.get(chatId) ?? []).slice(-params.limit).reverse();
  }

  async getUser(userId: number): Promise<FakeUser> {
    this.require(userId);
    return this.users.get(userId) ?? { isBot: false, isVerified: false };
  }

  async forwardMessagesById(params: {
    fromChatId: number;
    messages: number[];
    toChatId: number;
    toThreadId?: number;
  }): Promise<unknown> {
    this.require(params.fromChatId);
    this.require(params.toChatId);
    const error = this.forwardErrors.shift();
    if (error) throw error;
    this.forwards.push(params);
    this.events.push(`forward ${params.messages.join(',')}`);
    return [];
  }

  async getMe(): Promise<{ id: number }> {
    this.probes++;
    const error = this.probeErrors.shift();
    if (error) throw error;
    return { id: 1 };
  }

  async *iterDialogs(params: { archived: 'keep'; limit: number }) {
    this.dialogScans++;
    for (const id of this.dialogs.slice(0, params.limit)) {
      this.cached.add(id);
      yield { peer: { id } };
    }
  }
}

function fail(what: string): never {
  throw new Error(`fake: the ${what} of a message from another chat was read`);
}
