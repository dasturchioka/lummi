import {
  asc,
  discoverySet,
  eq,
  inArray,
  sql,
  volumes,
  type DbOrTx,
  type OrderLineRow,
} from '@lummi/db';
import { lineVolumeUnits } from '../catalog/catalog.service';

type LineKind = OrderLineRow['kind'];

/**
 * Where a line kind's bottles are on hand. A volume line and a builder set line both hold
 * volumes (`lineVolumeUnits`, the Reserve's own rule); a Discovery set's on hand is its own row
 * (ADR 0009), keyed by its vial ml, the line's `ml` (ADR 0042). A new line kind needs a case here and a shelf below, or this stops
 * compiling.
 */
function shelfOf(kind: LineKind) {
  switch (kind) {
    case 'volume':
    case 'builder_set':
      return 'volumes' as const;
    case 'discovery_set':
      return 'discovery_set' as const;
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

/**
 * The shelves in lock order: the Discovery rows first (ascending vial ml, their key and the
 * `OnHandChange` id), then volumes by ascending id. Checkout takes them in the same order, so a
 * handover and a concurrent checkout cannot wait on each other.
 */
const SHELF_ORDER: readonly Shelf[] = ['discovery_set', 'volumes'];

const SHELVES: Record<Shelf, ShelfOps> = {
  discovery_set: {
    async bottles(tx, orderId, positions) {
      if (positions.length === 0) return new Map();
      const { rows } = await tx.execute<{ ml: string; qty: string }>(sql`
        select ml, sum(qty) as qty from order_lines
        where order_id = ${orderId} and kind = 'discovery_set'
          and position in (${sql.join(
            positions.map((p) => sql`${p}`),
            sql`, `,
          )})
        group by ml`);
      return new Map(rows.map((r) => [Number(r.ml), Number(r.qty)]));
    },
    async lock(tx, ids) {
      if (ids.length === 0) return new Map();
      const rows = await tx
        .select({ vialMl: discoverySet.vialMl, onHand: discoverySet.onHand })
        .from(discoverySet)
        .where(inArray(discoverySet.vialMl, ids))
        .orderBy(asc(discoverySet.vialMl))
        .for('update');
      return new Map(rows.map((r) => [r.vialMl, r.onHand]));
    },
    async write(tx, vialMl, onHand) {
      await tx.update(discoverySet).set({ onHand }).where(eq(discoverySet.vialMl, vialMl));
    },
  },
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
  for (const shelf of SHELF_ORDER) {
    const positions = byShelf.get(shelf);
    if (!positions) continue;
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
