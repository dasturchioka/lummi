import {
  DISCOVERY_VIAL_MLS,
  NOT_SOLD_ALONE_ML,
  SET_SIZE,
  UZUM_SALES_PAGE_SIZE,
  asDiscoveryVialMl,
  type DiscoveryVialMl,
  type UzumSale,
  type UzumSaleInput,
  type UzumSaleItem,
  type UzumSaleLineInput,
  type UzumSalesPage,
  type UzumShortLine,
} from '@lummi/contracts';
import {
  asc,
  desc,
  eq,
  fragrances,
  inArray,
  isNull,
  ne,
  and,
  sql,
  staff,
  uzumSaleLines,
  uzumSales,
  volumes,
  type Db,
  type DbOrTx,
  type StaffRow,
  type UzumSaleLineRow,
  type UzumSaleRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { bottlesOf, readLiquidStock, type LiquidStock } from '../catalog/catalog.service';
import { readCostSettings } from '../cost/cost-settings';
import { costSnapshot, type CostedItem } from '../cost/order-costs';
import type { Edges } from '../edges';
import { loadDiscovery, type DiscoveryState } from '../sets/sets';
import { isOwner } from '../staff/staff.guard';
import { DB, EDGES } from '../tokens';
import { retryOrTryAgain, uniqueViolation } from '../util/transient';
import { applyStock, linksOf, lockStock, type LockedStock } from '../warehouse/stock-changes';

export type UzumFailure =
  | { ok: false; reason: 'not_found' | 'voided' | 'duplicate_order' | 'try_again' }
  | { ok: false; reason: 'invalid'; fields: string[] }
  /** On hand less the reserve can't cover these lines. */
  | { ok: false; reason: 'stock_short'; short: UzumShortLine[] };
export type UzumOutcome<T> = { ok: true; value: T } | UzumFailure;

/** A sale as the writer takes it, from the form or a file. */
export type NewUzumSale = UzumSaleInput & { via: 'form' | 'import'; rows?: number[] };

/**
 * A percent as the `numeric(5, 2)` column keeps it: two decimals, halves up (decimal, not binary:
 * 20.555 is 20.56), so the frozen costs and the row read the same commission.
 */
export const percent2 = (n: number) => Number(`${Math.round(Number(`${n}e2`))}e-2`);

const notFound = { ok: false, reason: 'not_found' } as const;

/** Rolls the transaction back with an answer, after it may already have written. */
class Refused extends Error {
  constructor(readonly failure: UzumFailure) {
    super(`uzum sale refused: ${failure.reason}`);
  }
}

/** A deadlock or serialization failure is run once more, then answered as `try_again`. */
const transient = <T>(run: () => Promise<UzumOutcome<T>>): Promise<UzumOutcome<T>> =>
  retryOrTryAgain<UzumOutcome<T>>(run, { ok: false, reason: 'try_again' });

/**
 * Uzum sales (#80). A sale fills its bottles from the ready concentrate at once (the parcel left
 * our shelf, ADR 0043), with their flacons and boxes, and freezes its profit on the Uzum channel; a
 * void brings it all back. Both lock as checkout and the BTS handover do (the fragrances in
 * ascending id, then the Discovery sets, then the consumables), then read the reserve under the
 * locks, so a sale and an order can't take the same ml. Every change leaves a stock move per
 * fragrance (the Discovery set has no history of its own) and an audit entry, in the same
 * transaction.
 */
@Injectable()
export class UzumSalesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EDGES) private readonly edges: Pick<Edges, 'clock'>,
  ) {}

  /** The list, newest first, with what the form can sell. Costs are the owner's. */
  async list(viewer: StaffRow, page: number): Promise<UzumSalesPage> {
    return this.db.transaction(
      async (tx) => {
        const [{ total } = { total: 0 }] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(uzumSales);
        const rows = await tx
          .select()
          .from(uzumSales)
          .orderBy(desc(uzumSales.id))
          .limit(UZUM_SALES_PAGE_SIZE)
          .offset((page - 1) * UZUM_SALES_PAGE_SIZE);
        const { order } = await readCostSettings(tx);
        return {
          sales: await salesOut(tx, rows, isOwner(viewer)),
          total,
          page,
          pageSize: UZUM_SALES_PAGE_SIZE,
          commissionPercent: order.uzumCommissionPercent,
          items: await saleItems(tx),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /** One sale from the form. */
  async record(actor: StaffRow, input: UzumSaleInput): Promise<UzumOutcome<UzumSale>> {
    const res = await this.recordMany(actor, [{ ...input, via: 'form' }]);
    if (!res.ok) return res;
    const [row] = await this.db.select().from(uzumSales).where(eq(uzumSales.id, res.value[0]!));
    const [sale] = await salesOut(this.db, [row!], isOwner(actor));
    return { ok: true, value: sale! };
  }

  /**
   * Records the sales in one transaction, all or none (the form's one, or a file's): their ids.
   * Given a function, it decides the sales inside that transaction (the import plans again there).
   */
  async recordMany(
    actor: StaffRow,
    sales: readonly NewUzumSale[] | ((tx: DbOrTx) => Promise<readonly NewUzumSale[]>),
  ): Promise<UzumOutcome<number[]>> {
    return transient(async () => {
      try {
        return await this.db.transaction(async (tx) => {
          const list = typeof sales === 'function' ? await sales(tx) : sales;
          return { ok: true, value: await this.write(tx, actor, list) } as const;
        });
      } catch (e) {
        if (e instanceof Refused) return e.failure;
        if (uniqueViolation(e) === 'uzum_sales_standing_order_idx')
          return { ok: false, reason: 'duplicate_order' } as const;
        throw e;
      }
    });
  }

  /** Voids a sale with a reason: its bottles come back on hand. */
  async void(actor: StaffRow, id: number, reason: string): Promise<UzumOutcome<UzumSale>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const [peek] = await tx.select().from(uzumSales).where(eq(uzumSales.id, id));
        if (!peek) return notFound;
        if (peek.voidedAt) return { ok: false, reason: 'voided' } as const;
        const lines = await tx
          .select()
          .from(uzumSaleLines)
          .where(eq(uzumSaleLines.saleId, id))
          .orderBy(asc(uzumSaleLines.position));
        // the stock first, in the one lock order; then the sale row
        const locked = await lockShelves(
          tx,
          lines.flatMap((l) => (l.kind === 'discovery_set' ? [asDiscoveryVialMl(l.ml)] : [])),
          lines.flatMap((l) => l.volumeId ?? []),
        );
        const [sale] = await tx.select().from(uzumSales).where(eq(uzumSales.id, id)).for('update');
        if (!sale || sale.voidedAt) return { ok: false, reason: 'voided' } as const;

        const now = this.edges.clock.now();
        const [row] = await tx
          .update(uzumSales)
          .set({ voidedAt: now, voidReason: reason, voidedBy: actor.id })
          .where(eq(uzumSales.id, id))
          .returning();
        const actorRef = { type: 'staff' as const, id: actor.id };
        await moveShelves(tx, locked, lines, +1, {
          kind: 'uzum_sale_voided',
          actor: actorRef,
          uzumSaleId: id,
          reason,
          details: { uzumOrder: sale.uzumOrder },
        });
        await this.audit.record(tx, {
          actor: actorRef,
          action: 'uzum.sale_voided',
          targetType: 'uzum_sale',
          targetId: id,
          payload: {
            uzumOrder: sale.uzumOrder,
            soldOn: sale.soldOn,
            lines: lines.map(lineAudit),
            revenue: sale.revenue,
            commissionPercent: sale.commissionPercent,
            reason,
          },
        });
        const [out] = await salesOut(tx, [row!], isOwner(actor));
        return { ok: true, value: out! } as const;
      }),
    );
  }

  /** The write itself, inside the caller's transaction; a refusal throws `Refused`. */
  private async write(tx: DbOrTx, actor: StaffRow, sales: readonly NewUzumSale[]) {
    const all = sales.flatMap((s) => s.lines);
    const volumeIds = [...new Set(all.flatMap((l) => (l.kind === 'volume' ? [l.volumeId] : [])))];
    const setMls = all.flatMap((l) => (l.kind === 'discovery_set' ? [l.vialMl] : []));
    const locked = await lockShelves(tx, setMls, volumeIds);
    // a volume that does not exist (or no longer does), or a 5 ml bottle (never sold alone,
    // ADR 0042), is the caller's mistake, named by its path
    const fields = sales.flatMap((s, si) =>
      s.lines.flatMap((l, i) =>
        l.kind === 'volume' &&
        (locked.volumes.get(l.volumeId)?.ml ?? NOT_SOLD_ALONE_ML) === NOT_SOLD_ALONE_ML
          ? [sales.length === 1 ? `lines.${i}.volumeId` : `sales.${si}.lines.${i}.volumeId`]
          : [],
      ),
    );
    if (fields.length) throw new Refused({ ok: false, reason: 'invalid', fields });
    await checkStock(tx, locked, all);

    const standing = await tx
      .select({ uzumOrder: uzumSales.uzumOrder })
      .from(uzumSales)
      .where(
        and(
          inArray(
            uzumSales.uzumOrder,
            sales.map((s) => s.uzumOrder),
          ),
          isNull(uzumSales.voidedAt),
        ),
      );
    if (standing.length) throw new Refused({ ok: false, reason: 'duplicate_order' });

    const costs = await readCostSettings(tx);
    // each Discovery set's five as they are now; a set short of them has nothing to cost
    const compositionOf = (ml: DiscoveryVialMl) =>
      locked.sets.get(ml)?.composition.map((f) => f.id) ?? [];
    const setItem = (ml: DiscoveryVialMl): CostedItem | null => {
      const five = compositionOf(ml);
      return five.length === SET_SIZE ? { kind: 'set', ml, fragranceIds: five } : null;
    };
    const fragranceIds = [
      ...new Set([
        ...[...locked.volumes.values()].map((v) => v.fragranceId),
        ...[...locked.sets.keys()].flatMap(compositionOf),
      ]),
    ];
    const oilRows = fragranceIds.length
      ? await tx
          .select({ id: fragrances.id, name: fragrances.name, oilPrice: fragrances.oilPrice })
          .from(fragrances)
          .where(inArray(fragrances.id, fragranceIds))
      : [];
    const oil = new Map(oilRows.map((r) => [r.id, { name: r.name, oilPrice: r.oilPrice }]));

    const now = this.edges.clock.now();
    const actorRef = { type: 'staff' as const, id: actor.id };
    const ids: number[] = [];
    for (const s of sales) {
      const commissionPercent = percent2(s.commissionPercent ?? costs.order.uzumCommissionPercent);
      const lines = s.lines.map((l) => {
        const v = l.kind === 'volume' ? locked.volumes.get(l.volumeId)! : null;
        const item: CostedItem | null = v
          ? { kind: 'volume', fragranceId: v.fragranceId, ml: v.ml }
          : setItem((l as { vialMl: DiscoveryVialMl }).vialMl);
        return { l, v, item, lineTotal: l.qty * l.price };
      });
      const revenue = lines.reduce((sum, x) => sum + x.lineTotal, 0);
      // the order's own arithmetic on the Uzum channel (#77): the sale's commission, no mailer,
      // no delivery, one ad, the tax
      const { snapshot, unitCosts } = costSnapshot(
        lines.map((x) => ({ item: x.item, qty: x.l.qty })),
        { channel: 'uzum', revenue, deliveryPaid: 0 },
        oil,
        { ...costs, order: { ...costs.order, uzumCommissionPercent: commissionPercent } },
        now,
      );
      const [row] = await tx
        .insert(uzumSales)
        .values({
          soldOn: s.soldOn,
          uzumOrder: s.uzumOrder,
          commissionPercent,
          revenue,
          costs: snapshot,
          source: s.via,
          createdBy: actor.id,
        })
        .returning();
      const saleLines = await tx
        .insert(uzumSaleLines)
        .values(
          lines.map((x, position) => ({
            saleId: row!.id,
            position,
            kind: x.l.kind,
            volumeId: x.l.kind === 'volume' ? x.l.volumeId : null,
            fragranceId: x.v?.fragranceId ?? null,
            name: x.v ? (oil.get(x.v.fragranceId)?.name ?? null) : null,
            ml: x.l.kind === 'volume' ? x.v!.ml : x.l.vialMl,
            qty: x.l.qty,
            price: x.l.price,
            lineTotal: x.lineTotal,
            unitCost: unitCosts[position] ?? null,
            setFragranceIds:
              x.l.kind === 'volume'
                ? null
                : compositionOf(x.l.vialMl).length
                  ? compositionOf(x.l.vialMl)
                  : null,
          })),
        )
        .returning();
      await moveShelves(tx, locked, saleLines, -1, {
        kind: 'uzum_sale',
        actor: actorRef,
        uzumSaleId: row!.id,
        details: { uzumOrder: s.uzumOrder },
      });
      await this.audit.record(tx, {
        actor: actorRef,
        action: 'uzum.sale_recorded',
        targetType: 'uzum_sale',
        targetId: row!.id,
        payload: {
          uzumOrder: s.uzumOrder,
          soldOn: s.soldOn,
          lines: saleLines.map(lineAudit),
          revenue,
          commissionPercent,
          via: s.via,
          ...(s.rows ? { rows: s.rows } : {}),
        },
      });
      ids.push(row!.id);
    }
    return ids;
  }
}

// ---- stock ----

interface Locked {
  /** The fragrances, the Discovery sets and the consumables the lines fill from, locked. */
  stock: LockedStock;
  /**
   * The Discovery sets the lines sell, by vial ml, each through its one read (`loadDiscovery`,
   * under the lock): its on hand, its five and what is available (0 unless it has all five).
   */
  sets: Map<DiscoveryVialMl, DiscoveryState>;
  volumes: Map<number, { fragranceId: number; ml: number }>;
}

/**
 * The stock a sale touches, locked as checkout and the BTS handover lock it (ADR 0043): the
 * fragrances of its volumes in ascending id, then the Discovery sets' rows, then the flacons and
 * boxes its bottles take. Values are as of the lock.
 */
async function lockShelves(
  tx: DbOrTx,
  setMls: readonly DiscoveryVialMl[],
  volumeIds: number[],
): Promise<Locked> {
  const rows = volumeIds.length
    ? await tx
        .select({ id: volumes.id, fragranceId: volumes.fragranceId, ml: volumes.ml })
        .from(volumes)
        .where(inArray(volumes.id, [...new Set(volumeIds)]))
    : [];
  const stock = await lockStock(tx, {
    fragranceIds: rows.map((r) => r.fragranceId),
    setMls,
    links: linksOf(
      rows.map((r) => ({ fragranceId: r.fragranceId, ml: r.ml, qty: 1, boxed: true })),
    ),
  });
  const sets = new Map<DiscoveryVialMl, DiscoveryState>();
  for (const ml of [...new Set(setMls)].sort((a, b) => a - b))
    sets.set(ml, await loadDiscovery(tx, ml));
  return { stock, sets, volumes: new Map(rows.map(({ id, ...v }) => [id, v])) };
}

/** What lines want: a volume by its id, a Discovery set by `set:<vial ml>`, summed. */
export type WantedStock = Map<number | `set:${DiscoveryVialMl}`, number>;

export function wantedOf(lines: readonly UzumSaleLineInput[]): WantedStock {
  const wanted: WantedStock = new Map();
  for (const l of lines) {
    const key = l.kind === 'volume' ? l.volumeId : (`set:${l.vialMl}` as const);
    wanted.set(key, (wanted.get(key) ?? 0) + l.qty);
  }
  return wanted;
}

/**
 * The lines that the stock can't cover (ADR 0043): each volume in the order the lines name it,
 * from its fragrance's one free liquid, so two volumes of one fragrance never both take the same
 * ml; a Discovery set from its own boxes. The record (under the locks) and the import's dry run
 * (without them) judge alike.
 */
export function shortLines(
  wanted: WantedStock,
  volumes: ReadonlyMap<number, { fragranceId: number; ml: number; name: string | null }>,
  setsAvailable: ReadonlyMap<DiscoveryVialMl, number>,
  stock: Pick<LiquidStock, 'free' | 'fill'>,
): UzumShortLine[] {
  const free = new Map<number, number>();
  const short: UzumShortLine[] = [];
  for (const [key, want] of wanted) {
    if (typeof key === 'string') {
      const ml = asDiscoveryVialMl(Number(key.slice(4)));
      const left = setsAvailable.get(ml) ?? 0;
      if (want > left)
        short.push({
          kind: 'discovery_set',
          volumeId: null,
          name: null,
          ml,
          wanted: want,
          available: left,
        });
      continue;
    }
    const v = volumes.get(key);
    if (!v) continue;
    const fill = stock.fill(v.ml);
    const has = free.get(v.fragranceId) ?? stock.free(v.fragranceId);
    const left = bottlesOf(has, fill);
    if (want > left)
      short.push({
        kind: 'volume',
        volumeId: key,
        name: v.name,
        ml: v.ml,
        wanted: want,
        available: left,
      });
    free.set(v.fragranceId, has - Math.min(want, left) * fill);
  }
  return short;
}

/** Refuses (`stock_short`) when the free concentrate (less the reserve, read under the locks) can't fill the lines. */
async function checkStock(tx: DbOrTx, locked: Locked, lines: readonly UzumSaleLineInput[]) {
  const ids = [...new Set([...locked.volumes.values()].map((v) => v.fragranceId))];
  const stock = await readLiquidStock(tx, ids);
  const short = shortLines(
    wantedOf(lines),
    new Map(
      [...locked.volumes].map(([id, v]) => [
        id,
        { ...v, name: locked.stock.fragrances.get(v.fragranceId)?.name ?? null },
      ]),
    ),
    new Map([...locked.sets].map(([ml, set]) => [ml, set.available])),
    stock,
  );
  if (short.length) throw new Refused({ ok: false, reason: 'stock_short', short });
}

/**
 * Fills the lines' bottles (`sign` −1 for a sale) or puts them back (+1 for a void) on the locked
 * stock: the liquid, a flacon and a box per bottle, a Discovery set's boxes; a stock move per
 * fragrance (`applyStock`).
 */
async function moveShelves(
  tx: DbOrTx,
  locked: Locked,
  lines: readonly Pick<UzumSaleLineRow, 'kind' | 'fragranceId' | 'ml' | 'qty'>[],
  sign: 1 | -1,
  move: Parameters<typeof applyStock>[2]['move'],
) {
  const bySet = new Map<DiscoveryVialMl, number>();
  for (const l of lines)
    if (l.kind === 'discovery_set') {
      const ml = asDiscoveryVialMl(l.ml);
      bySet.set(ml, (bySet.get(ml) ?? 0) + l.qty);
    }
  await applyStock(tx, locked.stock, {
    // a bottle sold alone on Uzum has its box (ADR 0043)
    fills: lines.flatMap((l) =>
      l.kind === 'volume' && l.fragranceId !== null
        ? [{ fragranceId: l.fragranceId, ml: l.ml, qty: l.qty, boxed: true }]
        : [],
    ),
    sign,
    sets: [...bySet].map(([vialMl, qty]) => ({ vialMl, change: sign * qty })),
    move,
  });
}

const lineAudit = (l: UzumSaleLineRow) => ({
  kind: l.kind,
  name: l.name,
  ml: l.ml,
  qty: l.qty,
  price: l.price,
});

// ---- reading ----

async function salesOut(
  tx: DbOrTx,
  rows: readonly UzumSaleRow[],
  owner: boolean,
): Promise<UzumSale[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const lines = await tx
    .select()
    .from(uzumSaleLines)
    .where(inArray(uzumSaleLines.saleId, ids))
    .orderBy(asc(uzumSaleLines.saleId), asc(uzumSaleLines.position));
  const staffIds = [...new Set(rows.flatMap((r) => [r.createdBy, r.voidedBy ?? []].flat()))];
  const names = new Map(
    (
      await tx
        .select({ id: staff.id, name: staff.name })
        .from(staff)
        .where(inArray(staff.id, staffIds))
    ).map((s) => [s.id, s.name]),
  );
  return rows.map((r) => {
    const saleLines = lines.filter((l) => l.saleId === r.id);
    return {
      id: r.id,
      soldOn: r.soldOn,
      uzumOrder: r.uzumOrder,
      commissionPercent: r.commissionPercent,
      lines: saleLines.map((l) => ({
        kind: l.kind,
        volumeId: l.volumeId,
        fragranceId: l.fragranceId,
        name: l.name,
        ml: l.ml,
        qty: l.qty,
        price: l.price,
        lineTotal: l.lineTotal,
        unitCost: owner ? l.unitCost : null,
      })),
      units: saleLines.reduce((sum, l) => sum + l.qty, 0),
      revenue: r.revenue,
      costs: owner ? r.costs : null,
      source: r.source,
      actorName: names.get(r.createdBy) ?? null,
      createdAt: r.createdAt.toISOString(),
      voided: r.voidedAt !== null,
      voidReason: r.voidReason,
      voidedAt: r.voidedAt?.toISOString() ?? null,
      voidedByName: r.voidedBy === null ? null : (names.get(r.voidedBy) ?? null),
    };
  });
}

/**
 * Every volume sold alone by fragrance name and ml (no 5 ml, ADR 0042), then both Discovery sets,
 * with what is available now (a volume: the bottles its fragrance's free concentrate fills).
 */
export async function saleItems(tx: DbOrTx): Promise<UzumSaleItem[]> {
  const rows = await tx
    .select({
      volumeId: volumes.id,
      fragranceId: volumes.fragranceId,
      name: fragrances.name,
      ml: volumes.ml,
      hidden: fragrances.hidden,
    })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(ne(volumes.ml, NOT_SOLD_ALONE_ML))
    .orderBy(asc(fragrances.name), asc(volumes.ml));
  const stock = await readLiquidStock(
    tx,
    rows.map((r) => r.fragranceId),
  );
  const sets = [];
  for (const vialMl of DISCOVERY_VIAL_MLS) sets.push(await loadDiscovery(tx, vialMl));
  return [
    ...rows.map((r) => ({
      kind: 'volume' as const,
      ...r,
      available: stock.bottles(r.fragranceId, r.ml),
    })),
    // through each set's one read: 0 unless it has all five
    ...sets.map((set) => ({
      kind: 'discovery_set' as const,
      vialMl: set.vialMl,
      available: set.available,
    })),
  ];
}
