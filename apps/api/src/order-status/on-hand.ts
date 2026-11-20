import { asDiscoveryVialMl, type DiscoveryVialMl } from '@lummi/contracts/constants';
import { sql, type DbOrTx, type OrderLineRow } from '@lummi/db';
import type { Actor } from '../audit/audit.service';
import { lineFills } from '../catalog/catalog.service';
import {
  applyStock,
  linksOf,
  lockStock,
  type AppliedStock,
  type FillLine,
} from '../warehouse/stock-changes';

/** What a status change does to the stock: the lines whose bottles leave (-1) or come back (+1). */
export interface OnHandMove {
  lines: readonly OrderLineRow[];
  sign: 1 | -1;
}

/** The bottles these lines of one order fill, per fragrance and ml; a volume line's take a box too. */
async function fillsOf(
  tx: DbOrTx,
  orderId: number,
  lines: readonly OrderLineRow[],
): Promise<FillLine[]> {
  const positions = lines.filter((l) => l.kind !== 'discovery_set').map((l) => l.position);
  if (positions.length === 0) return [];
  const { rows } = await tx.execute<{
    position: number;
    fragrance_id: string;
    ml: number;
    qty: string;
  }>(sql`
    select u.position, u.fragrance_id, u.ml, sum(u.qty) as qty
    from (${lineFills}) u
    where u.order_id = ${orderId} and u.position in (${sql.join(
      positions.map((p) => sql`${p}`),
      sql`, `,
    )})
    group by u.position, u.fragrance_id, u.ml`);
  const kindAt = new Map(lines.map((l) => [l.position, l.kind]));
  return rows.map((r) => ({
    fragranceId: Number(r.fragrance_id),
    ml: Number(r.ml),
    qty: Number(r.qty),
    // a bottle sold alone has its box; a builder set's vials have none (ADR 0040, 0043)
    boxed: kindAt.get(Number(r.position)) === 'volume',
  }));
}

/** A Discovery line's set: its `ml` is the set's vial size (ADR 0042). */
const setOf = (l: OrderLineRow): DiscoveryVialMl => asDiscoveryVialMl(l.ml);

/**
 * Locks the stock of every line of the order (the fragrances in ascending id, then the Discovery
 * sets, then the consumables the moved bottles take: the order checkout and every stock path use),
 * so a move that ends the reserve steps in line with a concurrent checkout; then moves the stock by
 * `move` (ADR 0010, 0043): down when bottles are filled at BTS handover, up when a parcel comes back
 * or a returned line goes back to stock. Never below zero and never refused: a bottle that
 * physically left was filled whatever the count said; the move records the shortfall. One stock
 * move per fragrance (`sale` or `returned`).
 */
export async function changeOnHand(
  tx: DbOrTx,
  orderId: number,
  lines: readonly OrderLineRow[],
  move: OnHandMove,
  actor: Actor,
  kind: 'sale' | 'returned',
  now: Date,
): Promise<AppliedStock> {
  const all = await fillsOf(tx, orderId, lines);
  const moved = await fillsOf(tx, orderId, move.lines);
  const locked = await lockStock(tx, {
    fragranceIds: all.map((f) => f.fragranceId),
    setMls: lines.filter((l) => l.kind === 'discovery_set').map(setOf),
    links: linksOf(moved),
  });
  const sets = new Map<DiscoveryVialMl, number>();
  for (const l of move.lines)
    if (l.kind === 'discovery_set') sets.set(setOf(l), (sets.get(setOf(l)) ?? 0) + l.qty);
  return applyStock(tx, locked, {
    fills: moved,
    sign: move.sign,
    sets: [...sets].map(([vialMl, qty]) => ({ vialMl, change: move.sign * qty })),
    move: { kind, actor, orderId },
    now,
  });
}
