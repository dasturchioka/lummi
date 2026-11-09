import type { Clock } from './clock';
import type { FileStore } from './file-store';
import type { ReceiptJudge } from './receipt-judge';
import type { TelegramSender } from './telegram-sender';

export * from './clock';
export * from './file-store';
export * from './receipt-judge';
export * from './receipt-ai';
export * from './receipt-judge-factory';
export * from './telegram-sender';

/** The four edges of ADR 0028 seam 1: everything slow, paid, or outside our process. */
export interface Edges {
  clock: Clock;
  telegram: TelegramSender;
  receiptJudge: ReceiptJudge;
  files: FileStore;
}
