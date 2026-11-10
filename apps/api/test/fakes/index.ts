import { BotBlockedError, InvalidFileIdError } from '../../src/edges';
import type {
  Clock,
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

export class FakeTelegramSender implements TelegramSender {
  readonly sent: OutboundMessage[] = [];
  /** Chats that answer 403, like a user who blocked the bot. */
  readonly blockedChats = new Set<number>();
  /** One-shot errors per chat, thrown by the next sends to it (a 429, a 400, ...). */
  readonly failures = new Map<number, Error[]>();
  /** File ids Telegram no longer accepts. */
  readonly rejectedFileIds = new Set<string>();
  /** Callback queries answered, by id. */
  readonly answered: string[] = [];
  async answerCallback(callbackQueryId: string): Promise<void> {
    this.answered.push(callbackQueryId);
  }
  async send(message: OutboundMessage): Promise<SendResult> {
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
    this.sent.push(message);
    // an upload yields a file_id, like Telegram; a send by id yields none
    return {
      messageId: this.sent.length,
      ...(message.photo && 'bytes' in message.photo
        ? { photoFileId: `file-${this.sent.length}` }
        : {}),
    };
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
