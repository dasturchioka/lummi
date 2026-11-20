import type { Clock } from './clock';
import type { FileStore } from './file-store';
import type { ReceiptJudge } from './receipt-judge';
import type { TelegramFiles } from './telegram-files';
import type { TelegramSender } from './telegram-sender';

export * from './clock';
export * from './file-store';
export * from './receipt-judge';
export * from './receipt-ai';
export * from './receipt-judge-factory';
export * from './telegram-files';
export * from './telegram-sender';

/** The edges of ADR 0028 seam 1: everything slow, paid, or outside our process. */
export interface Edges {
  clock: Clock;
  telegram: TelegramSender;
  receiptJudge: ReceiptJudge;
  files: FileStore;
  /** Files users send to the bot (#31). */
  telegramFiles: TelegramFiles;
}
