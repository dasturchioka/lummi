import { asc, eq, inArray, sql, volumes, type DbOrTx, type OrderLineRow } from '@lummi/db';
import { lineVolumeUnits } from '../catalog/catalog.service';

type LineKind = OrderLineRow['kind'];

/**
 * Where a line kind's bottles are on hand. A volume line and a builder set line both hold
 * 10/30/50 ml volumes (`lineVolumeUnits`, the Reserve's own rule). #22 adds the Discovery set,
 * whose on hand is its own row: one case here and one shelf below, or this stops compiling.
 */
function shelfOf(kind: LineKind) {
  switch (kind) {
    case 'volume':
    case 'builder_set':
      return 'volumes' as const;
    default: {
      const unknown: never = kind;
      throw new Error(`no shelf for order line kind ${String(unknown)}`);
    }
  }
}
type Shelf = ReturnType<typeof shelfOf>;

/** One on-hand row as a status change moved it; kept in the order's history and the audit. */
export interface OnHandChange {
  shelf: Shelf;
  id: number;
  from: number;
  to: number;
}

interface ShelfOps {
  /** The bottles these lines of one order hold, per row of this shelf. */
  bottles(tx: DbOrTx, orderId: number, positions: number[]): Promise<Map<number, number>>;
  /** Locks the rows `FOR UPDATE` in ascending id; their on hand under the lock. */
  lock(tx: DbOrTx, ids: number[]): Promise<Map<number, number>>;
  write(tx: DbOrTx, id: number, onHand: number): Promise<void>;
}

const SHELVES: Record<Shelf, ShelfOps> = {
  volumes: {
    async bottles(tx, orderId, positions) {
      if (positions.length === 0) return new Map();
      const list = sql.join(
        positions.map((p) => sql`${p}`),
        sql`, `,
      );
      const { rows } = await tx.execute<{ volume_id: string; qty: string }>(sql`
        select u.volume_id, sum(u.qty) as qty
        from (${lineVolumeUnits}) u
        where u.order_id = ${orderId} and u.position in (${list})
        group by u.volume_id`);
      return new Map(rows.map((r) => [Number(r.volume_id), Number(r.qty)]));
    },
    async lock(tx, ids) {
      if (ids.length === 0) return new Map();
      const rows = await tx
        .select({ id: volumes.id, onHand: volumes.onHand })
        .from(volumes)
        .where(inArray(volumes.id, ids))
        .orderBy(asc(volumes.id))
        .for('update');
      return new Map(rows.map((r) => [r.id, r.onHand]));
    },
    async write(tx, id, onHand) {
      await tx.update(volumes).set({ onHand }).where(eq(volumes.id, id));
    },
  },
};

/** What a status change does to on hand: the lines whose bottles leave (-1) or come back (+1). */
export interface OnHandMove {
  lines: readonly OrderLineRow[];
  sign: 1 | -1;
}

/**
 * Locks the on-hand rows of every line of the order (ascending id, the order checkout and the
 * admin on-hand saves use), so a move that ends the reserve steps in line with a concurrent
 * checkout; then moves on hand by `move` (ADR 0010): down when bottles leave at BTS handover, up
 * when a parcel comes back or a returned line goes back to stock. Never below zero: a bottle that
 * physically left was on the shelf whatever the count said; the history keeps the numbers.
 */
export async function changeOnHand(
  tx: DbOrTx,
  orderId: number,
  lines: readonly OrderLineRow[],
  move: OnHandMove,
): Promise<OnHandChange[]> {
  const byShelf = new Map<Shelf, { all: number[]; moved: number[] }>();
  const moved = new Set(move.lines.map((l) => l.position));
  for (const line of lines) {
    const shelf = shelfOf(line.kind);
    const own = byShelf.get(shelf) ?? { all: [], moved: [] };
    own.all.push(line.position);
    if (moved.has(line.position)) own.moved.push(line.position);
    byShelf.set(shelf, own);
  }
  const changes: OnHandChange[] = [];
  for (const [shelf, positions] of byShelf) {
    const ops = SHELVES[shelf];
    const held = await ops.bottles(tx, orderId, positions.all);
    const locked = await ops.lock(tx, [...held.keys()]);
    const bottles = await ops.bottles(tx, orderId, positions.moved);
    for (const [id, qty] of [...bottles].sort(([a], [b]) => a - b)) {
      const from = locked.get(id);
      if (from === undefined) throw new Error(`${shelf} ${id} is not locked`);
      const to = Math.max(0, from + move.sign * qty);
      await ops.write(tx, id, to);
      changes.push({ shelf, id, from, to });
    }
  }
  return changes;
}
