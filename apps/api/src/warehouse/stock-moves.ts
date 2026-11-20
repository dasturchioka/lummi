import type { StockMoveKind } from '@lummi/contracts';
import { stockMoves, type DbOrTx } from '@lummi/db';
import type { Actor } from '../audit/audit.service';

/**
 * The one writer of the warehouse history (ADR 0041, 0043). Every change of an oil balance, a
 * ready concentrate or a consumable's count comes through here, in the transaction that made it, so
 * the history can't miss one or show one that rolled back.
 */
export interface StockMoveInput {
  /** Null for a consumable's own receipt or count. */
  fragranceId: number | null;
  kind: StockMoveKind;
  actor: Actor;
  /** Signed change of the oil balance, mg. */
  oilMg?: number;
  /** Signed change of the ready concentrate, µl. */
  concentrateUl?: number;
  /** Bottles filled, handed over or returned, by ml (signed). */
  bottles?: Record<number, number>;
  /** Signed change of consumables' counts, by id. */
  consumables?: Record<number, number>;
  oilReceiptId?: number;
  bottlingId?: number;
  orderId?: number;
  uzumSaleId?: number;
  reason?: string | null;
  details?: Record<string, unknown>;
}

const nonZero = (changes: Record<number, number> | undefined) =>
  Object.fromEntries(Object.entries(changes ?? {}).filter(([, change]) => change !== 0));

export async function recordStockMove(tx: DbOrTx, m: StockMoveInput): Promise<void> {
  await tx.insert(stockMoves).values({
    fragranceId: m.fragranceId,
    kind: m.kind,
    oilMg: m.oilMg ?? 0,
    concentrateUl: m.concentrateUl ?? 0,
    bottles: nonZero(m.bottles),
    consumables: nonZero(m.consumables),
    oilReceiptId: m.oilReceiptId ?? null,
    bottlingId: m.bottlingId ?? null,
    orderId: m.orderId ?? null,
    uzumSaleId: m.uzumSaleId ?? null,
    reason: m.reason ?? null,
    details: m.details ?? {},
    actorType: m.actor.type,
    actorId: m.actor.id ?? null,
  });
}

