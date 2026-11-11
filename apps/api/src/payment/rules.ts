import { ACCEPTED_RECEIPT_VERDICTS, WAITING_RECEIPT_VERDICTS } from '@lummi/contracts';
import { orders, receipts, sql, type DbOrTx, type ReceiptRow, type SQL } from '@lummi/db';
import { readSettings } from '../settings/settings.service';

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
 * Receipts `a` and `b` (SQL aliases) are the same receipt: the same file (SHA-256), or, while the
 * setting `receipts.duplicateImageDistance` is a number, images whose 64-bit perceptual hashes
 * (#28) differ in at most that many bits (#36).
 */
export function sameReceipt(a: string, b: string, maxDistance: number | null): SQL {
  const [x, y] = [sql.raw(a), sql.raw(b)];
  const sameFile = sql`${x}.sha256 = ${y}.sha256`;
  if (maxDistance === null) return sameFile;
  return sql`(${sameFile} or bit_count(('x' || ${x}.phash)::bit(64) # ('x' || ${y}.phash)::bit(64)) <= ${maxDistance})`;
}

/**
 * THE duplicate rule (spec 2026-11-07; #32, #36): receipt `twin` counts against receipt `r` when
 * it is the same receipt and was accepted, or was sent for a different order. With `repeat`, only
 * the twins `r` repeats: accepted, or sent before `r` for a different order.
 */
export function twinOf(maxDistance: number | null, opts: { repeat: boolean }): SQL {
  return sql`(
    twin.id <> r.id and ${sameReceipt('twin', 'r', maxDistance)}
    and (
      twin.verdict in (${sqlList(ACCEPTED_VERDICTS)})
      or (twin.order_id <> r.order_id ${opts.repeat ? sql`and twin.id < r.id` : sql``})
    )
  )`;
}

/**
 * Receipt `r` is a duplicate: it never confirms itself and the AI is never asked (#32). The later
 * receipt (`isRepeat`) takes the payment-not-found path (#36); the first waits for a person.
 */
export const isDuplicate = (maxDistance: number | null) =>
  sql`exists (select 1 from ${receipts} twin where ${twinOf(maxDistance, { repeat: false })})`;
/** Receipt `r` is a repeat receipt (GLOSSARY): the same as one accepted, or sent earlier for another order. */
export const isRepeat = (maxDistance: number | null) =>
  sql`exists (select 1 from ${receipts} twin where ${twinOf(maxDistance, { repeat: true })})`;

/** The setting `receipts.duplicateImageDistance`: null compares whole files only. */
export async function duplicateImageDistance(db: DbOrTx): Promise<number | null> {
  return (await readSettings(db, ['receipts.duplicateImageDistance']))[
    'receipts.duplicateImageDistance'
  ];
}

/** Whether the receipt is a duplicate (`isDuplicate`). */
export async function isDuplicateReceipt(db: DbOrTx, receiptId: number): Promise<boolean> {
  const maxDistance = await duplicateImageDistance(db);
  const { rows } = await db.execute<{ duplicate: boolean }>(
    sql`select ${isDuplicate(maxDistance)} as duplicate from ${receipts} r where r.id = ${receiptId}`,
  );
  return rows[0]?.duplicate === true;
}
