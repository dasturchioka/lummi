import { Injectable, Logger } from '@nestjs/common';
import { describeError } from '../logging/describe-error';

/** What a subscriber (payment matching) learns when a new credit is recorded. */
export interface CreditRecorded {
  creditId: number;
  /** Whole so'm, compared with an order's amount due; null when the credit has tiyin. */
  amountSom: number | null;
  /** The notification's time (minute precision), UTC. */
  occurredAt: Date;
  cardLast4: string;
}

export type CreditRecordedListener = (event: CreditRecorded) => void | Promise<void>;

/**
 * The "credit recorded" hook (ADR 0012: receipts are re-matched on every new credit). A small typed
 * in-process event: it fires after the credit's transaction commits, so a listener sees the row.
 * Listeners run one after another and the intake waits for them; one that throws is logged and
 * neither fails the intake nor stops the others.
 *
 * It is the fast path only. A crash between the commit and the listeners loses the event, so a
 * subscriber must also catch up on its own (say, a sweep over credits not yet considered).
 */
@Injectable()
export class CreditEvents {
  private readonly log = new Logger('CreditEvents');
  private readonly listeners = new Set<CreditRecordedListener>();

  /** Subscribe; returns the unsubscribe function. */
  onCreditRecorded(listener: CreditRecordedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emitCreditRecorded(event: CreditRecorded): Promise<void> {
    for (const listener of [...this.listeners]) {
      try {
        await listener(event);
      } catch (e) {
        this.log.error(`credit ${event.creditId}: a listener failed: ${describeError(e)}`);
      }
    }
  }
}
