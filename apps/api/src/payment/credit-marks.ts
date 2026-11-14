import { charCount } from '@lummi/contracts';
import { credits, eq, orders, type CreditRow, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { PaymentMatching } from './payment-matching';

/** What an unmark answers: the credit as it is now, or why not. */
export type CreditUnmarkOutcome =
  | { kind: 'done'; credit: CreditRow }
  | { kind: 'not_found' }
  /** An order holds the credit: a credit that paid an order is never marked. */
  | { kind: 'credit_taken'; credit: CreditRow }
  /** Already marked (a mark), or not marked (an unmark): a stale screen. Nothing changed. */
  | { kind: 'credit_changed'; credit: CreditRow };

/** What a mark answers: as an unmark, or the note is longer than `payments.creditMarkNoteMaxLength`. */
export type CreditMarkOutcome = CreditUnmarkOutcome | { kind: 'note_too_long'; max: number };

/**
 * «Не для заказа» (GLOSSARY: Not for an order; #49). Staff (owner or manager) mark an unlinked
 * credit that is not shop money, a personal transfer to the shop card: the Candidate rule
 * (`rules.ts`) then skips it, so payment matching never shows it to the AI, the link dialogs never
 * offer it, the door (`PaymentConfirmation`) refuses it, and it leaves the Home's «Поступления без
 * заказа». «Вернуть в поступления» takes the mark off and offers the credit to matching again.
 *
 * Both run under the credit's row lock, the lock `PaymentConfirmation` takes second (after the
 * order's, which a mark has none of), and re-read the link there: a mark and a link racing for one
 * credit end with exactly one of them, the other hearing `credit_taken`. Each is audited with the
 * staff member, in the same transaction.
 */
@Injectable()
export class CreditMarks {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PaymentMatching) private readonly matching: PaymentMatching,
  ) {}

  /** Marks the credit not for an order, with the staff member's optional note (trimmed; '' is none). */
  async mark(staffId: number, creditId: number, note?: string): Promise<CreditMarkOutcome> {
    return this.db.transaction(async (tx) => {
      const [credit] = await tx
        .select()
        .from(credits)
        .where(eq(credits.id, creditId))
        .for('update');
      if (!credit) return { kind: 'not_found' };
      // under the credit's lock: a link that won the race has committed by now
      const [payer] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.creditId, credit.id));
      if (payer) return { kind: 'credit_taken', credit };
      if (credit.notForOrderAt !== null) return { kind: 'credit_changed', credit };
      const text = note?.trim() || null;
      if (text !== null) {
        const { 'payments.creditMarkNoteMaxLength': max } = await readSettings(tx, [
          'payments.creditMarkNoteMaxLength',
        ]);
        // characters as a person counts them, as the panel's counter does
        if (charCount(text) > max) return { kind: 'note_too_long', max };
      }
      const [marked] = await tx
        .update(credits)
        .set({
          notForOrderAt: this.edges.clock.now(),
          notForOrderBy: staffId,
          notForOrderNote: text,
        })
        .where(eq(credits.id, credit.id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: staffId },
        action: 'credit.marked_not_for_order',
        targetType: 'credit',
        targetId: credit.id,
        payload: { ...described(credit), note: text },
      });
      return { kind: 'done', credit: marked! };
    });
  }

  /** «Вернуть в поступления»: the mark comes off, and matching looks at the credit again. */
  async unmark(staffId: number, creditId: number): Promise<CreditUnmarkOutcome> {
    const out = await this.db.transaction(async (tx): Promise<CreditUnmarkOutcome> => {
      const [credit] = await tx
        .select()
        .from(credits)
        .where(eq(credits.id, creditId))
        .for('update');
      if (!credit) return { kind: 'not_found' };
      if (credit.notForOrderAt === null) return { kind: 'credit_changed', credit };
      const [free] = await tx
        .update(credits)
        .set({ notForOrderAt: null, notForOrderBy: null, notForOrderNote: null })
        .where(eq(credits.id, credit.id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: staffId },
        action: 'credit.unmarked_not_for_order',
        targetType: 'credit',
        targetId: credit.id,
        payload: {
          ...described(credit),
          note: credit.notForOrderNote,
          markedBy: credit.notForOrderBy,
          markedAt: credit.notForOrderAt.toISOString(),
        },
      });
      return { kind: 'done', credit: free! };
    });
    // the re-check a new credit gets, after the commit (best effort; the sweep catches up)
    if (out.kind === 'done') await this.matching.queueForCredit(creditId);
    return out;
  }
}

/** The credit as an audit entry names it (no personal data: the amount, the time, the card's last 4). */
const described = (c: CreditRow) => ({
  amountTiyin: c.amountTiyin,
  occurredAt: c.occurredAt.toISOString(),
  cardLast4: c.cardLast4,
});
