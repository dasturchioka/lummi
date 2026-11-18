import type { StockMoveKind } from '@lummi/contracts';
import { inArray, stockMoves, volumes, type DbOrTx } from '@lummi/db';
import type { Actor } from '../audit/audit.service';

/**
 * The one writer of a fragrance's warehouse history (ADR 0041). Every change of an oil balance or
 * of bottles on hand comes through here, in the transaction that made it, so the history can't
 * miss one or show one that rolled back.
 */
export interface StockMoveInput {
  fragranceId: number;
  kind: StockMoveKind;
  actor: Actor;
  /** Signed change of the oil balance, mg. */
  oilMg?: number;
  /** Signed change of bottles on hand, by ml. */
  bottles?: Record<number, number>;
  receiptId?: number;
  bottlingId?: number;
  orderId?: number;
  reason?: string | null;
  details?: Record<string, unknown>;
}

export async function recordStockMove(tx: DbOrTx, m: StockMoveInput): Promise<void> {
  await tx.insert(stockMoves).values({
    fragranceId: m.fragranceId,
    kind: m.kind,
    oilMg: m.oilMg ?? 0,
    bottles: Object.fromEntries(
      Object.entries(m.bottles ?? {}).filter(([, change]) => change !== 0),
    ),
    receiptId: m.receiptId ?? null,
    bottlingId: m.bottlingId ?? null,
    orderId: m.orderId ?? null,
    reason: m.reason ?? null,
    details: m.details ?? {},
    actorType: m.actor.type,
    actorId: m.actor.id ?? null,
  });
}

/** One volume's on hand as a change moved it. */
export interface CountChange {
  volumeId: number;
  from: number;
  to: number;
}

/**
 * On-hand changes of volumes, one stock move per fragrance they belong to (a builder set's lines
 * span five). Volumes whose count did not move are left out; nothing moved, nothing written.
 */
export async function recordCountChanges(
  tx: DbOrTx,
  changes: readonly CountChange[],
  base: Omit<StockMoveInput, 'fragranceId' | 'bottles' | 'oilMg'>,
): Promise<void> {
  const moved = changes.filter((c) => c.to !== c.from);
  if (moved.length === 0) return;
  const rows = await tx
    .select({ id: volumes.id, fragranceId: volumes.fragranceId, ml: volumes.ml })
    .from(volumes)
    .where(
      inArray(
        volumes.id,
        moved.map((c) => c.volumeId),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byFragrance = new Map<number, Record<number, number>>();
  for (const c of moved) {
    const v = byId.get(c.volumeId);
    if (!v) throw new Error(`volume ${c.volumeId} is gone`);
    const bottles = byFragrance.get(v.fragranceId) ?? {};
    bottles[v.ml] = (bottles[v.ml] ?? 0) + (c.to - c.from);
    byFragrance.set(v.fragranceId, bottles);
  }
  for (const [fragranceId, bottles] of [...byFragrance].sort(([a], [b]) => a - b)) {
    await recordStockMove(tx, { ...base, fragranceId, bottles });
  }
}
