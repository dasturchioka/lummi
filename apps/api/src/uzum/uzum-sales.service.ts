import {
  UZUM_SALES_PAGE_SIZE,
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
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  inArray,
  isNull,
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
import { available, reservedByVolume } from '../catalog/catalog.service';
import { readCostSettings } from '../cost/cost-settings';
import type { CostedItem } from '../cost/order-costs';
import type { Edges } from '../edges';
import { readDiscoverySet, reservedDiscovery } from '../sets/sets';
import { isOwner } from '../staff/staff.guard';
import { DB, EDGES } from '../tokens';
import { retryOrTryAgain, uniqueViolation } from '../util/transient';
import { recordStockMove } from '../warehouse/stock-moves';
import { uzumSaleCosts } from './uzum-costs';

export type UzumFailure =
  | { ok: false; reason: 'not_found' | 'voided' | 'duplicate_order' | 'try_again' }
  | { ok: false; reason: 'invalid'; fields: string[] }
  /** On hand less the reserve can't cover these lines. */
  | { ok: false; reason: 'stock_short'; short: UzumShortLine[] };
export type UzumOutcome<T> = { ok: true; value: T } | UzumFailure;

/** A sale as the writer takes it, from the form or a file. */
export type NewUzumSale = UzumSaleInput & { via: 'form' | 'import'; rows?: number[] };

/** The Discovery set's ml: five 10 ml vials (ADR 0009), as its order lines record it. */
const DISCOVERY_ML = 10;

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
 * Uzum sales (#80). A sale lowers on hand at once (the parcel left our shelf) and freezes its profit
 * on the Uzum channel; a void brings the bottles back. Both lock as checkout and the BTS handover
 * do: the Discovery set's row first, then volumes in ascending id; then read the reserve under the
 * locks, so a sale and an order can't take the same bottle. Every change leaves a stock move per
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
          lines.some((l) => l.kind === 'discovery_set'),
          lines.flatMap((l) => l.volumeId ?? []),
        );
        const [sale] = await tx.select().from(uzumSales).where(eq(uzumSales.id, id)).for('update');
        if (!sale || sale.voidedAt) return { ok: false, reason: 'voided' } as const;

        const now = this.edges.clock.now();
        await moveShelves(tx, locked, lines, +1);
        const [row] = await tx
          .update(uzumSales)
          .set({ voidedAt: now, voidReason: reason, voidedBy: actor.id })
          .where(eq(uzumSales.id, id))
          .returning();
        const actorRef = { type: 'staff' as const, id: actor.id };
        for (const [fragranceId, bottles] of bottlesByFragrance(lines, +1)) {
          await recordStockMove(tx, {
            fragranceId,
            kind: 'uzum_sale_voided',
            actor: actorRef,
            bottles,
            uzumSaleId: id,
            reason,
            details: { uzumOrder: sale.uzumOrder },
          });
        }
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
    const known = volumeIds.length
      ? await tx.select({ id: volumes.id }).from(volumes).where(inArray(volumes.id, volumeIds))
      : [];
    const knownIds = new Set(known.map((v) => v.id));
    const fields = sales.flatMap((s, si) =>
      s.lines.flatMap((l, i) =>
        l.kind === 'volume' && !knownIds.has(l.volumeId)
          ? [sales.length === 1 ? `lines.${i}.volumeId` : `sales.${si}.lines.${i}.volumeId`]
          : [],
      ),
    );
    if (fields.length) throw new Refused({ ok: false, reason: 'invalid', fields });

    const withSet = all.some((l) => l.kind === 'discovery_set');
    const locked = await lockShelves(tx, withSet, volumeIds);
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
    const composition = withSet
      ? (
          await tx
            .select({ fragranceId: discoverySetItems.fragranceId })
            .from(discoverySetItems)
            .orderBy(asc(discoverySetItems.position))
        ).map((r) => r.fragranceId)
      : [];
    const fragranceIds = [
      ...new Set([...[...locked.volumes.values()].map((v) => v.fragranceId), ...composition]),
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
      const commissionPercent = s.commissionPercent ?? costs.order.uzumCommissionPercent;
      const lines = s.lines.map((l) => {
        const v = l.kind === 'volume' ? locked.volumes.get(l.volumeId)! : null;
        const item: CostedItem | null = v
          ? { kind: 'volume', fragranceId: v.fragranceId, ml: v.ml }
          : composition.length
            ? { kind: 'set', ml: DISCOVERY_ML, fragranceIds: composition }
            : null;
        return { l, v, item, lineTotal: l.qty * l.price };
      });
      const revenue = lines.reduce((sum, x) => sum + x.lineTotal, 0);
      const { snapshot, unitCosts } = uzumSaleCosts(
        lines.map((x) => ({ item: x.item, qty: x.l.qty, lineTotal: x.lineTotal })),
        commissionPercent,
        oil,
        costs,
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
            ml: x.v?.ml ?? DISCOVERY_ML,
            qty: x.l.qty,
            price: x.l.price,
            lineTotal: x.lineTotal,
            unitCost: unitCosts[position] ?? null,
            setFragranceIds: x.v ? null : composition,
          })),
        )
        .returning();
      await moveShelves(tx, locked, saleLines, -1);
      for (const [fragranceId, bottles] of bottlesByFragrance(saleLines, -1)) {
        await recordStockMove(tx, {
          fragranceId,
          kind: 'uzum_sale',
          actor: actorRef,
          bottles,
          uzumSaleId: row!.id,
          details: { uzumOrder: s.uzumOrder },
        });
      }
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
  /** The Discovery set's on hand, when a line sells it. */
  discovery: number | null;
  volumes: Map<number, { fragranceId: number; ml: number; onHand: number }>;
}

/**
 * The shelves a sale touches, locked as checkout and the BTS handover lock them: the Discovery
 * set's row first, then the volumes in ascending id. Values are as of the lock.
 */
async function lockShelves(tx: DbOrTx, withSet: boolean, volumeIds: number[]): Promise<Locked> {
  const discovery = withSet ? (await readDiscoverySet(tx, true)).onHand : null;
  const rows = volumeIds.length
    ? await tx
        .select({
          id: volumes.id,
          fragranceId: volumes.fragranceId,
          ml: volumes.ml,
          onHand: volumes.onHand,
        })
        .from(volumes)
        .where(inArray(volumes.id, [...new Set(volumeIds)]))
        .orderBy(asc(volumes.id))
        .for('update')
    : [];
  return { discovery, volumes: new Map(rows.map(({ id, ...v }) => [id, v])) };
}

/** Refuses (`stock_short`) when on hand less the reserve, read under the locks, can't cover the lines. */
async function checkStock(tx: DbOrTx, locked: Locked, lines: readonly UzumSaleLineInput[]) {
  const wanted = new Map<number | 'set', number>();
  for (const l of lines) {
    const key = l.kind === 'volume' ? l.volumeId : 'set';
    wanted.set(key, (wanted.get(key) ?? 0) + l.qty);
  }
  const reserved = await reservedByVolume(tx, [...locked.volumes.keys()]);
  const short: UzumShortLine[] = [];
  const names = new Map<number, string>();
  const ids = [...new Set([...locked.volumes.values()].map((v) => v.fragranceId))];
  if (ids.length)
    for (const f of await tx
      .select({ id: fragrances.id, name: fragrances.name })
      .from(fragrances)
      .where(inArray(fragrances.id, ids)))
      names.set(f.id, f.name);
  for (const [key, want] of wanted) {
    if (key === 'set') {
      const free = available(locked.discovery ?? 0, await reservedDiscovery(tx));
      if (want > free)
        short.push({
          kind: 'discovery_set',
          volumeId: null,
          name: null,
          ml: null,
          wanted: want,
          available: free,
        });
      continue;
    }
    const v = locked.volumes.get(key)!;
    const free = available(v.onHand, reserved.get(key) ?? 0);
    if (want > free)
      short.push({
        kind: 'volume',
        volumeId: key,
        name: names.get(v.fragranceId) ?? null,
        ml: v.ml,
        wanted: want,
        available: free,
      });
  }
  if (short.length) throw new Refused({ ok: false, reason: 'stock_short', short });
}

/** Moves on hand by the lines' quantities (`sign` −1 for a sale, +1 for a void), on the locked rows. */
async function moveShelves(
  tx: DbOrTx,
  locked: Locked,
  lines: readonly Pick<UzumSaleLineRow, 'kind' | 'volumeId' | 'qty'>[],
  sign: 1 | -1,
) {
  let set = 0;
  const byVolume = new Map<number, number>();
  for (const l of lines) {
    if (l.kind === 'discovery_set') set += l.qty;
    else byVolume.set(l.volumeId!, (byVolume.get(l.volumeId!) ?? 0) + l.qty);
  }
  if (set > 0) {
    locked.discovery = (locked.discovery ?? 0) + sign * set;
    await tx
      .update(discoverySet)
      .set({ onHand: locked.discovery })
      .where(eq(discoverySet.id, true));
  }
  for (const [id, qty] of [...byVolume].sort(([a], [b]) => a - b)) {
    const v = locked.volumes.get(id)!;
    v.onHand += sign * qty;
    await tx.update(volumes).set({ onHand: v.onHand }).where(eq(volumes.id, id));
  }
}

/** The lines' bottles per fragrance, signed, keyed by ml: one stock move each. */
function bottlesByFragrance(
  lines: readonly Pick<UzumSaleLineRow, 'fragranceId' | 'ml' | 'qty'>[],
  sign: 1 | -1,
): [number, Record<number, number>][] {
  const out = new Map<number, Record<number, number>>();
  for (const l of lines) {
    if (l.fragranceId === null) continue;
    const b = out.get(l.fragranceId) ?? {};
    b[l.ml] = (b[l.ml] ?? 0) + sign * l.qty;
    out.set(l.fragranceId, b);
  }
  return [...out].sort(([a], [b]) => a - b);
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
    const its = lines.filter((l) => l.saleId === r.id);
    return {
      id: r.id,
      soldOn: r.soldOn,
      uzumOrder: r.uzumOrder,
      commissionPercent: r.commissionPercent,
      lines: its.map((l) => ({
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
      units: its.reduce((sum, l) => sum + l.qty, 0),
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

/** Every volume by fragrance name and ml, then the Discovery set, with what is available now. */
export async function saleItems(tx: DbOrTx): Promise<UzumSaleItem[]> {
  const rows = await tx
    .select({
      volumeId: volumes.id,
      fragranceId: volumes.fragranceId,
      name: fragrances.name,
      ml: volumes.ml,
      onHand: volumes.onHand,
      hidden: fragrances.hidden,
    })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .orderBy(asc(fragrances.name), asc(volumes.ml));
  const reserved = await reservedByVolume(
    tx,
    rows.map((r) => r.volumeId),
  );
  const set = await readDiscoverySet(tx);
  return [
    ...rows.map(({ onHand, ...r }) => ({
      kind: 'volume' as const,
      ...r,
      available: available(onHand, reserved.get(r.volumeId) ?? 0),
    })),
    {
      kind: 'discovery_set' as const,
      available: available(set.onHand, await reservedDiscovery(tx)),
    },
  ];
}
