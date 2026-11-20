import type { ConsumableUse, DiscoveryVialMl } from '@lummi/contracts/constants';
import {
  and,
  asc,
  consumables,
  discoverySet,
  eq,
  fragrances,
  inArray,
  sql,
  type ConsumableRow,
  type DbOrTx,
  type DiscoverySetRow,
} from '@lummi/db';
import { readCostSettings } from '../cost/cost-settings';
import { fillUl, type LiquidSettings } from '../cost/unit-cost';
import { lockDiscoverySets } from '../sets/sets';
import { recordStockMove, type StockMoveInput } from './stock-moves';

/*
 * Bottles filled from the ready concentrate, and put back (ADR 0043): the one writer the BTS
 * handover, a cancel or return, an Uzum sale or its void and a set assembly share. It locks in the
 * one order every stock path takes (the fragrance rows in ascending id, `FOR NO KEY UPDATE`; then
 * the Discovery set rows by vial ml; then the consumables by id), moves the counts, and writes one
 * stock move per fragrance with the flacons and boxes its bottles took.
 */

/** The uses the shop takes by itself; `other` is counted by hand only. */
type LinkedUse = Exclude<ConsumableUse, 'other'>;
/** What a bottle takes from the consumables: a flacon of its ml, a box when sold alone; mixing the ethanol. */
export type ConsumableLink = `${LinkedUse}:${number}`;
export const linkOf = (use: LinkedUse, ml: number | null): ConsumableLink => `${use}:${ml ?? 0}`;
/** The order a move lists and counts its consumables in: by use, then ml, numerically. */
const USE_ORDER: Record<LinkedUse, number> = { flacon: 0, box: 1, ethanol: 2 };
function compareLinks(a: ConsumableLink, b: ConsumableLink): number {
  const [ua, ma] = a.split(':') as [LinkedUse, string];
  const [ub, mb] = b.split(':') as [LinkedUse, string];
  return USE_ORDER[ua] - USE_ORDER[ub] || Number(ma) - Number(mb);
}
/** The link of an item read under the lock (asked for by link, so never `other`). */
function linkOfRow(c: ConsumableRow): ConsumableLink {
  if (c.use === 'other') throw new Error(`consumable ${c.id} has no link`);
  return linkOf(c.use, c.ml);
}

/** Bottles of one fragrance and ml. `boxed`: sold alone (10 / 30 / 50 ml), so it takes a box too. */
export interface FillLine {
  fragranceId: number;
  ml: number;
  qty: number;
  boxed: boolean;
}

/** Every row a change touches, locked, as it was under the lock. */
export interface LockedStock {
  liquid: LiquidSettings;
  fragrances: Map<number, LockedFragrance>;
  sets: Map<DiscoveryVialMl, DiscoverySetRow>;
  /** The active consumable of each link asked for; a link with none is simply not counted. */
  consumables: Map<ConsumableLink, ConsumableRow>;
}

/** The links the fills take: a flacon of each ml, a box of each boxed ml. */
export function linksOf(fills: readonly FillLine[]): ConsumableLink[] {
  return [
    ...new Set(
      fills.flatMap((f) => [linkOf('flacon', f.ml), ...(f.boxed ? [linkOf('box', f.ml)] : [])]),
    ),
  ];
}

/** A fragrance row as its stock lock read it. */
export interface LockedFragrance {
  name: string;
  oilMg: number;
  concentrateUl: number;
}

/**
 * Locks fragrance rows `FOR NO KEY UPDATE` in ascending id: the first lock of every stock path
 * (checkout, the handover, Uzum, mixing, assembly, counts; ADR 0043). Their oil and concentrate
 * under it. The one place that takes this lock.
 */
export async function lockFragrances(
  tx: DbOrTx,
  fragranceIds: readonly number[],
): Promise<Map<number, LockedFragrance>> {
  const ids = [...new Set(fragranceIds)].sort((a, b) => a - b);
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: fragrances.id,
      name: fragrances.name,
      oilMg: fragrances.oilMg,
      concentrateUl: fragrances.concentrateUl,
    })
    .from(fragrances)
    .where(inArray(fragrances.id, ids))
    .orderBy(asc(fragrances.id))
    .for('no key update');
  return new Map(rows.map(({ id, ...r }) => [id, r]));
}

/**
 * Locks the fragrances (ascending id), then the Discovery sets (ascending vial ml), then the
 * consumables of `links` (ascending id), and reads them under the locks.
 */
export async function lockStock(
  tx: DbOrTx,
  want: {
    fragranceIds: readonly number[];
    setMls?: readonly DiscoveryVialMl[];
    links?: readonly ConsumableLink[];
  },
): Promise<LockedStock> {
  const locked = await lockFragrances(tx, want.fragranceIds);
  const sets = await lockDiscoverySets(tx, want.setMls ?? []);
  const links = [...new Set(want.links ?? [])];
  const found = links.length
    ? await tx
        .select()
        .from(consumables)
        .where(
          and(
            eq(consumables.archived, false),
            sql`(${consumables.use}::text || ':' || coalesce(${consumables.ml}, 0)) in (${sql.join(
              links.map((l) => sql`${l}`),
              sql`, `,
            )})`,
          ),
        )
        .orderBy(asc(consumables.id))
        .for('update')
    : [];
  return {
    liquid: (await readCostSettings(tx)).liquid,
    fragrances: locked,
    sets,
    consumables: new Map(found.map((c) => [linkOfRow(c), c])),
  };
}

/** One count as a change moved it. */
export interface CountChange<K> {
  id: K;
  from: number;
  to: number;
}

/** What `applyStock` moved: for the order's history and the audit. */
export interface AppliedStock {
  fragrances: CountChange<number>[];
  sets: CountChange<DiscoveryVialMl>[];
  consumables: CountChange<number>[];
}

/**
 * Fills (`sign` −1: bottles leave; +1: they come back) and set boxes (`sets`, signed) on the locked
 * rows. A count never goes below zero: what it could not give is recorded on the move (`short`)
 * and a consumable is flagged for a recount; nothing is refused here (the callers that must refuse
 * check under the same locks first). One stock move per fragrance with bottles, `move` its kind,
 * actor and documents.
 */
export async function applyStock(
  tx: DbOrTx,
  locked: LockedStock,
  change: {
    fills: readonly FillLine[];
    sign: 1 | -1;
    sets?: readonly { vialMl: DiscoveryVialMl; change: number }[];
    move: Omit<
      StockMoveInput,
      'fragranceId' | 'concentrateUl' | 'bottles' | 'consumables' | 'oilMg'
    >;
    /** The Clock edge's now (ADR 0028): when the consumables' counts moved. */
    now: Date;
  },
): Promise<AppliedStock> {
  const { sign } = change;
  const out: AppliedStock = { fragrances: [], sets: [], consumables: [] };

  for (const s of [...(change.sets ?? [])].sort((a, b) => a.vialMl - b.vialMl)) {
    const row = locked.sets.get(s.vialMl);
    if (!row) throw new Error(`discovery_set ${s.vialMl} is not locked`);
    const from = row.onHand;
    const to = Math.max(0, from + s.change);
    row.onHand = to;
    await tx.update(discoverySet).set({ onHand: to }).where(eq(discoverySet.vialMl, s.vialMl));
    out.sets.push({ id: s.vialMl, from, to });
  }

  // per fragrance, in ascending id: its bottles, its liquid, the consumables its bottles take
  const byFragrance = new Map<number, FillLine[]>();
  for (const f of change.fills) {
    if (f.qty <= 0) continue;
    byFragrance.set(f.fragranceId, [...(byFragrance.get(f.fragranceId) ?? []), f]);
  }
  const counted = new Map<number, { from: number; row: ConsumableRow; short: boolean }>();
  for (const [fragranceId, fills] of [...byFragrance].sort(([a], [b]) => a - b)) {
    const f = locked.fragrances.get(fragranceId);
    if (!f) throw new Error(`fragrance ${fragranceId} is not locked`);
    const bottles: Record<number, number> = {};
    let need = 0;
    const uses = new Map<ConsumableLink, number>();
    for (const l of fills) {
      bottles[l.ml] = (bottles[l.ml] ?? 0) + sign * l.qty;
      need += l.qty * fillUl(l.ml, locked.liquid);
      for (const link of linksOf([l])) uses.set(link, (uses.get(link) ?? 0) + l.qty);
    }
    const from = f.concentrateUl;
    const to = Math.max(0, from + sign * need);
    const shortUl = sign < 0 ? need - (from - to) : 0;
    f.concentrateUl = to;
    await tx.update(fragrances).set({ concentrateUl: to }).where(eq(fragrances.id, fragranceId));
    out.fragrances.push({ id: fragranceId, from, to });

    const moved: Record<number, number> = {};
    const short: Record<number, number> = {};
    for (const [link, qty] of [...uses].sort(([a], [b]) => compareLinks(a, b))) {
      const c = locked.consumables.get(link);
      if (!c) continue;
      const seen = counted.get(c.id) ?? { from: c.onHand, row: c, short: false };
      const taken = sign < 0 ? Math.min(c.onHand, qty) : qty;
      c.onHand += sign * taken;
      if (taken > 0) moved[c.id] = (moved[c.id] ?? 0) + sign * taken;
      if (sign < 0 && taken < qty) {
        short[c.id] = (short[c.id] ?? 0) + qty - taken;
        seen.short = true;
      }
      counted.set(c.id, seen);
    }
    const shortOf =
      shortUl > 0 || Object.keys(short).length > 0
        ? {
            short: {
              ...(shortUl > 0 ? { concentrateUl: shortUl } : {}),
              ...(Object.keys(short).length > 0 ? { consumables: short } : {}),
            },
          }
        : {};
    await recordStockMove(tx, {
      ...change.move,
      fragranceId,
      concentrateUl: to - from,
      bottles,
      consumables: moved,
      details: { ...change.move.details, ...shortOf },
    });
  }

  for (const [id, { from, row, short }] of [...counted].sort(([a], [b]) => a - b)) {
    await tx
      .update(consumables)
      .set({ onHand: row.onHand, ...(short ? { needsRecount: true } : {}), updatedAt: change.now })
      .where(eq(consumables.id, id));
    if (short) row.needsRecount = true;
    if (row.onHand !== from) out.consumables.push({ id, from, to: row.onHand });
  }
  return out;
}
