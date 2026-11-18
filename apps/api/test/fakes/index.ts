import { BotBlockedError, InvalidFileIdError, MessageGoneError } from '../../src/edges';
import type {
  Clock,
  EditedMessage,
  Edges,
  FileStore,
  OutboundMessage,
  ReceiptJudge,
  ReceiptJudgeInput,
  ReceiptJudgement,
  FileDownload,
  SendResult,
  TelegramFiles,
  TelegramSender,
} from '../../src/edges';

export class FakeClock implements Clock {
  constructor(private current = new Date('2026-11-09T10:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  set(date: Date): void {
    this.current = new Date(date);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** A message as Telegram holds it now: as sent, then as last edited. */
export interface SentMessage extends OutboundMessage {
  messageId: number;
  /** The text as a person reads it: HTML tags dropped and entities decoded when parse_mode is HTML. */
  plain: string;
  /** How many times it was edited. */
  edits: number;
}

/** Text as Telegram shows an HTML message: tags dropped, the four entities decoded. */
export function plainText(text: string, options?: Record<string, unknown>): string {
  if (options?.parse_mode !== 'HTML') return text;
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export class FakeTelegramSender implements TelegramSender {
  readonly sent: OutboundMessage[] = [];
  /** Every message sent, by its message id, as Telegram shows it now (edits applied). */
  readonly messages = new Map<number, SentMessage>();
  /** Every edit, in order. */
  readonly edited: EditedMessage[] = [];
  /** Chats that answer 403, like a user who blocked the bot. */
  readonly blockedChats = new Set<number>();
  /** One-shot errors per chat, thrown by the next sends to it (a 429, a 400, ...). */
  readonly failures = new Map<number, Error[]>();
  /** File ids Telegram no longer accepts. */
  readonly rejectedFileIds = new Set<string>();
  /** Callback queries answered, by id. */
  readonly answered: string[] = [];
  /** Callback answers with their toast text, in order. */
  readonly answers: { id: string; text?: string }[] = [];
  /** While true, each edit waits here until the test lands it (applies) or fails it: a slow Telegram. */
  holdEdits = false;
  readonly heldEdits: { message: EditedMessage; land: () => void; fail: (e: Error) => void }[] = [];
  /** The same for sends. */
  holdSends = false;
  readonly heldSends: { message: OutboundMessage; land: () => void; fail: (e: Error) => void }[] =
    [];
  /**
   * Groups that became supergroups (old id → new id): Telegram refuses the old id, and an edit
   * there answers what `editError` maps to `MessageGoneError`.
   */
  readonly migrated = new Map<number, number>();
  /** Profile photos the bot can see, by Telegram user id: the file_id getUserProfilePhotos returns. */
  readonly profilePhotos = new Map<number, string>();
  async profilePhotoFileId(telegramId: number): Promise<string | null> {
    return this.profilePhotos.get(telegramId) ?? null;
  }
  async answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    this.answered.push(callbackQueryId);
    this.answers.push({ id: callbackQueryId, ...(text === undefined ? {} : { text }) });
  }
  async send(message: OutboundMessage): Promise<SendResult> {
    if (this.holdSends)
      await new Promise<void>((land, fail) => this.heldSends.push({ message, land, fail }));
    if (
      message.photo &&
      'fileId' in message.photo &&
      this.rejectedFileIds.has(message.photo.fileId)
    ) {
      throw new InvalidFileIdError();
    }
    const failure = this.failures.get(message.chatId)?.shift();
    if (failure) throw failure;
    if (this.blockedChats.has(message.chatId)) throw new BotBlockedError(message.chatId);
    if (this.migrated.has(message.chatId))
      throw new Error('Bad Request: group chat was upgraded to a supergroup chat');
    this.sent.push(message);
    const messageId = this.sent.length;
    this.messages.set(messageId, {
      ...message,
      messageId,
      plain: plainText(message.text, message.options),
      edits: 0,
    });
    // an upload yields a file_id, like Telegram; a send by id yields none
    return {
      messageId,
      ...(message.photo && 'bytes' in message.photo ? { photoFileId: `file-${messageId}` } : {}),
    };
  }
  /** Like Telegram: an edit that changes nothing is "not modified", which the real sender swallows. */
  async edit(message: EditedMessage): Promise<void> {
    if (this.holdEdits)
      await new Promise<void>((land, fail) => this.heldEdits.push({ message, land, fail }));
    if (this.migrated.has(message.chatId)) throw new MessageGoneError();
    const failure = this.failures.get(message.chatId)?.shift();
    if (failure) throw failure;
    if (this.blockedChats.has(message.chatId)) throw new BotBlockedError(message.chatId);
    const current = this.messages.get(message.messageId);
    if (!current || current.chatId !== message.chatId) throw new MessageGoneError();
    this.edited.push(message);
    const options = { ...current.options, ...message.options };
    this.messages.set(message.messageId, {
      ...current,
      text: message.text,
      options,
      plain: plainText(message.text, options),
      edits: current.edits + 1,
    });
  }
  /** Stop holding, and fail whatever is held: a test that stopped halfway leaves nothing hanging. */
  releaseHeld(): void {
    this.holdEdits = false;
    this.holdSends = false;
    for (const held of [...this.heldEdits.splice(0), ...this.heldSends.splice(0)])
      held.fail(new Error('test over'));
  }
  /** Forget everything sent (between tests). */
  reset(): void {
    this.sent.length = 0;
    this.messages.clear();
    this.edited.length = 0;
    this.answered.length = 0;
    this.answers.length = 0;
    this.failures.clear();
    this.blockedChats.clear();
    this.releaseHeld();
    this.migrated.clear();
    this.profilePhotos.clear();
  }
}

export class FakeReceiptJudge implements ReceiptJudge {
  readonly calls: ReceiptJudgeInput[] = [];
  /** Script the next verdict(s); the last one repeats. Defaults to "not a receipt". */
  verdicts: ReceiptJudgement[] = [
    {
      isReceipt: 0,
      amountMatches: 0,
      recipientMatches: 0,
      chosenCreditId: null,
      choiceConfidence: 0,
      confirmed: false,
      provider: 'none',
    },
  ];
  /** Answers from the question itself when set (a judge that picks a candidate it was shown); wins over `verdicts`. */
  respond?: (input: ReceiptJudgeInput) => ReceiptJudgement | Promise<ReceiptJudgement>;
  async judge(input: ReceiptJudgeInput): Promise<ReceiptJudgement> {
    this.calls.push(input);
    if (this.respond) return this.respond(input);
    const verdict = this.verdicts.length > 1 ? this.verdicts.shift()! : this.verdicts[0]!;
    return verdict;
  }
}

export class FakeFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();
  async put(key: string, data: Uint8Array): Promise<void> {
    this.files.set(key, data);
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.files.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

/** Files "on Telegram" by file_id; a download over the cap answers `too_large` like the real one. */
export class FakeTelegramFiles implements TelegramFiles {
  readonly files = new Map<string, Uint8Array>();
  /** Every file_id asked for, in order. */
  readonly downloads: string[] = [];
  async download(fileId: string, maxBytes: number): Promise<FileDownload> {
    this.downloads.push(fileId);
    const bytes = this.files.get(fileId);
    if (!bytes) return { kind: 'unavailable' };
    return bytes.length > maxBytes ? { kind: 'too_large' } : { kind: 'ok', bytes };
  }
  /** Files behind a signed `photo_url`, by URL. */
  readonly urls = new Map<string, Uint8Array>();
  /** Every photo_url asked for, in order. */
  readonly urlDownloads: string[] = [];
  async downloadUrl(url: string, maxBytes: number): Promise<FileDownload> {
    this.urlDownloads.push(url);
    const bytes = this.urls.get(url);
    if (!bytes) return { kind: 'unavailable' };
    return bytes.length > maxBytes ? { kind: 'too_large' } : { kind: 'ok', bytes };
  }
}

export interface FakeEdges extends Edges {
  clock: FakeClock;
  telegram: FakeTelegramSender;
  receiptJudge: FakeReceiptJudge;
  files: FakeFileStore;
  telegramFiles: FakeTelegramFiles;
}

export function createFakeEdges(): FakeEdges {
  return {
    clock: new FakeClock(),
    telegram: new FakeTelegramSender(),
    receiptJudge: new FakeReceiptJudge(),
    files: new FakeFileStore(),
    telegramFiles: new FakeTelegramFiles(),
  };
}
