import { ACCEPTED_RECEIPT_VERDICTS, WAITING_RECEIPT_VERDICTS } from '@lummi/contracts';
import { orders, receipts, sql, type DbOrTx, type ReceiptRow } from '@lummi/db';

type ReceiptVerdict = ReceiptRow['verdict'];

/** The contracts' verdict lists, the one source for both doors and the panel (ADR 0012). */
export const WAITING_VERDICTS: readonly ReceiptVerdict[] = WAITING_RECEIPT_VERDICTS;
export const ACCEPTED_VERDICTS: readonly ReceiptVerdict[] = ACCEPTED_RECEIPT_VERDICTS;

/** `('a', 'b')` for `in (…)`, bound as parameters. */
export const sqlList = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/*
 * THE Candidate credit rule (GLOSSARY; ADR 0012, 0013), in one place, as SQL over `o` (the
 * order), `c` (a credit) and `sc` (the shop card). Matching selects candidates with `CANDIDATE`;
 * `PaymentConfirmation` asks the same pieces about the one credit it is given, so it can tell
 * staff which one does not fit.
 */
/** The credit is the order's Amount due to the so'm (a credit with tiyin has no `amount_som`). */
export const AMOUNT_FITS = sql`c.amount_som = o.amount_due`;
/** No earlier than the minute the order was created: Humo keeps only the minute. */
export const IN_ORDER_TIME = sql`c.occurred_at >= date_trunc('minute', o.created_at, 'UTC')`;
/** It went to the shop card (its last 4 digits). */
export const ON_SHOP_CARD = sql`c.card_last4 = right(sc.number, 4)`;
/** It paid no order yet. */
export const UNLINKED = sql`not exists (select 1 from ${orders} paid where paid.credit_id = c.id)`;
export const CANDIDATE = sql`(${AMOUNT_FITS}) and (${IN_ORDER_TIME}) and (${ON_SHOP_CARD}) and (${UNLINKED})`;

/**
 * Receipt `r` is a duplicate: the same file (SHA-256) as another receipt that was accepted, or
 * that was sent for a different order. A duplicate never confirms itself (spec 2026-11-07); #36
 * adds the perceptual hash.
 */
export const IS_DUPLICATE = sql`exists (
  select 1 from ${receipts} twin
  where twin.sha256 = r.sha256 and twin.id <> r.id
    and (twin.verdict in (${sqlList(ACCEPTED_VERDICTS)}) or twin.order_id <> r.order_id)
)`;

/** Whether the receipt is a duplicate (`IS_DUPLICATE`). */
export async function isDuplicateReceipt(db: DbOrTx, receiptId: number): Promise<boolean> {
  const { rows } = await db.execute<{ duplicate: boolean }>(
    sql`select ${IS_DUPLICATE} as duplicate from ${receipts} r where r.id = ${receiptId}`,
  );
  return rows[0]?.duplicate === true;
}
