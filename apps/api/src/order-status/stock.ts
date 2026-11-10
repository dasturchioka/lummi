import { asc, eq, inArray, volumes, type DbOrTx, type OrderLineRow } from '@lummi/db';

type StockLine = Pick<OrderLineRow, 'kind' | 'volumeId' | 'setVolumeIds' | 'qty'>;

/**
 * The bottles a set of order lines physically takes from the warehouse, per volume: a volume line
 * its quantity, a builder set line one 10 ml of each of its five fragrances per set (ADR 0009,
 * 0010). The same rule as the Reserve (`reservedByVolume`).
 */
export function stockUnits(lines: readonly StockLine[]): Map<number, number> {
  const units = new Map<number, number>();
  const add = (volumeId: number, qty: number) =>
    units.set(volumeId, (units.get(volumeId) ?? 0) + qty);
  for (const line of lines) {
    switch (line.kind) {
      case 'volume':
        if (line.volumeId === null) throw new Error('a volume line without its volume');
        add(line.volumeId, line.qty);
        break;
      case 'builder_set':
        for (const id of line.setVolumeIds ?? []) add(id, line.qty);
        break;
    }
  }
  return units;
}

/**
 * Locks the volume rows `FOR UPDATE` in ascending id, the order checkout and the admin on-hand
 * saves use, so a status change that moves the reserve or on hand never deadlocks with them.
 * Returns each row's on hand as it is under the lock.
 */
export async function lockVolumes(tx: DbOrTx, ids: Iterable<number>): Promise<Map<number, number>> {
  const list = [...new Set(ids)];
  if (list.length === 0) return new Map();
  const rows = await tx
    .select({ id: volumes.id, onHand: volumes.onHand })
    .from(volumes)
    .where(inArray(volumes.id, list))
    .orderBy(asc(volumes.id))
    .for('update');
  return new Map(rows.map((r) => [r.id, r.onHand]));
}

export interface OnHandChange {
  volumeId: number;
  /** On hand before and after. */
  onHand: [number, number];
}

/**
 * Moves on hand by `sign` x units per volume (ADR 0010): down when the bottles leave at BTS
 * handover, up when a parcel comes back or a returned line goes back to stock. Never below zero:
 * a bottle that physically left was on the shelf whatever the count said. The rows must already
 * be locked (`lockVolumes`); the changes go into the order's history.
 */
export async function moveOnHand(
  tx: DbOrTx,
  locked: Map<number, number>,
  units: Map<number, number>,
  sign: 1 | -1,
): Promise<OnHandChange[]> {
  const changes: OnHandChange[] = [];
  for (const [volumeId, qty] of [...units].sort(([a], [b]) => a - b)) {
    const before = locked.get(volumeId);
    if (before === undefined) throw new Error(`volume ${volumeId} is not locked`);
    const after = Math.max(0, before + sign * qty);
    await tx.update(volumes).set({ onHand: after }).where(eq(volumes.id, volumeId));
    locked.set(volumeId, after);
    changes.push({ volumeId, onHand: [before, after] });
  }
  return changes;
}
