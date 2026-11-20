import {
  WAREHOUSE_HISTORY_LIMIT,
  type ConcentrateCountBody,
  type MixingResult,
  type OilReceipt,
  type OilReceiptCorrection,
  type OilReceiptInput,
  type OilReceiptDraftsBody,
  type SetAssemblyResult,
  type StockMove,
  type WarehouseFragrance,
} from '@lummi/contracts';
import { formatLocalDate, tashkentDay } from '@lummi/contracts';
import {
  DISCOVERY_SETS,
  SET_SIZE,
  type ConsumableUnit,
  type DiscoveryVialMl,
} from '@lummi/contracts/constants';
import {
  and,
  asc,
  consumables,
  desc,
  eq,
  fragrances,
  inArray,
  oilReceipts,
  orders,
  sql,
  staff,
  stockMoves,
  volumes,
  type Db,
  type DbOrTx,
  type OilReceiptRow,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { readLiquidStock } from '../catalog/catalog.service';
import { readCostSettings } from '../cost/cost-settings';
import { fillUl, mixNeeds } from '../cost/unit-cost';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { isOwner } from '../staff/staff.guard';
import { retryOrTryAgain } from '../util/transient';
import { fragranceStock, readStockContext, round3 } from './fragrance-stock';
import { gramsFromMg, mgFromGrams, mixingNeeds, mlFromUl, oilReceiptCost, ulFromMl } from './oil';
import { applyStock, linkOf, lockStock } from './stock-changes';
import { recordStockMove } from './stock-moves';
import { readComposition } from '../sets/sets';

export type WarehouseFailure =
  | { ok: false; reason: 'not_found' | 'voided' | 'draft' | 'not_draft' | 'try_again' }
  | { ok: false; reason: 'invalid'; fields: string[] }
  /** The oil balance holds less than the operation takes. */
  | { ok: false; reason: 'oil_short'; neededMg: number; balanceMg: number }
  /** A mixing needs more ethanol than there is (ml). */
  | { ok: false; reason: 'ethanol_short'; neededMl: number; balanceMl: number }
  /** A set assembly needs more of a fragrance's free concentrate than there is (µl). */
  | {
      ok: false;
      reason: 'concentrate_short';
      neededUl: number;
      balanceUl: number;
      fragrance: string;
    }
  /** A count compared against one that moved meanwhile (µl). */
  | { ok: false; reason: 'changed'; currentUl: number };
export type WarehouseOutcome<T> = { ok: true; value: T } | WarehouseFailure;

const notFound = { ok: false, reason: 'not_found' } as const;
const short = (neededMg: number, balanceMg: number) =>
  ({ ok: false, reason: 'oil_short', neededMg, balanceMg }) as const;

/** A deadlock or serialization failure is run once more, then answered as `try_again`. */
const transient = <T>(run: () => Promise<WarehouseOutcome<T>>): Promise<WarehouseOutcome<T>> =>
  retryOrTryAgain<WarehouseOutcome<T>>(run, { ok: false, reason: 'try_again' });

function oilReceiptOut(r: OilReceiptRow): OilReceipt {
  return {
    id: r.id,
    fragranceId: r.fragranceId,
    supplier: r.supplier,
    invoice: r.invoice,
    receivedOn: r.receivedOn,
    grams: gramsFromMg(r.oilMg),
    pricePerGram: r.pricePerGram,
    discountPercent: r.discountPercent,
    importPercent: r.importPercent,
    ...oilReceiptCost(r),
    draft: r.draft,
    voided: r.voidedAt !== null,
    voidReason: r.voidReason,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The oil receipt's columns from the form; grams are kept in milligrams. */
const oilReceiptColumns = (input: OilReceiptInput) => ({
  supplier: input.supplier,
  invoice: input.invoice,
  receivedOn: input.receivedOn,
  oilMg: mgFromGrams(input.grams),
  pricePerGram: input.pricePerGram,
  discountPercent: input.discountPercent,
  importPercent: input.importPercent,
});

/**
 * The raw-material warehouse (#76, ADR 0041): the oil balance of each fragrance beside its bottles
 * on hand. An oil receipt, its correction or void, and a bottling each lock the fragrance row first
 * (`FOR NO KEY UPDATE`, then its volumes in ascending id, the order checkout and the fragrance form
 * use), check the balance under the lock, write, and leave a stock move and an audit entry in the
 * same transaction.
 */
@Injectable()
export class WarehouseService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  /**
   * The fragrance's warehouse page. Oil receipts, their defaults, values, and the invoices and
   * suppliers in the history are the owner's only.
   */
  async get(
    id: number,
    viewer: StaffRow,
    db: DbOrTx = this.db,
  ): Promise<WarehouseFragrance | null> {
    const owner = isOwner(viewer);
    const read = async (tx: DbOrTx) => {
      const [f] = await tx.select().from(fragrances).where(eq(fragrances.id, id));
      if (!f) return null;
      const ctx = await readStockContext(tx, owner);
      const l = ctx.costs.liquid;
      const vols = await tx
        .select({ ml: volumes.ml })
        .from(volumes)
        .where(eq(volumes.fragranceId, id))
        .orderBy(asc(volumes.ml));
      const reserved = (await readLiquidStock(tx, [id])).of(id).reservedUl;
      const all = await tx
        .select()
        .from(oilReceipts)
        .where(eq(oilReceipts.fragranceId, id))
        .orderBy(desc(oilReceipts.id));
      const standing = all.filter((r) => r.voidedAt === null && !r.draft);
      const drafts = owner ? all.filter((r) => r.draft).length : 0;
      const [ethanol] = await tx
        .select({ id: consumables.id, onHand: consumables.onHand })
        .from(consumables)
        .where(and(eq(consumables.use, 'ethanol'), eq(consumables.archived, false)));
      const perMl = mixNeeds(1, l);
      return {
        fragranceId: f.id,
        name: f.name,
        hidden: f.hidden,
        stock: fragranceStock(
          f,
          reserved,
          vols.filter((v) => v.ml !== 5).map((v) => v.ml),
          standing,
          ctx,
          drafts,
        ),
        lowConcentrateMl: ctx.lowConcentrateMl,
        lowOilMl: ctx.lowOilMl,
        perMl: { oilGrams: round3(perMl.oilGrams), ethanolMl: round3(perMl.ethanolMl) },
        fills: vols.map((v) => ({ ml: v.ml, fillMl: mlFromUl(fillUl(v.ml, l)) })),
        ethanol: ethanol ? { id: ethanol.id, onHandMl: ethanol.onHand } : null,
        oilReceipts: owner ? all.map(oilReceiptOut) : null,
        oilReceiptDefaults: owner
          ? {
              supplier: f.oilSupplier,
              pricePerGram: f.oilPrice,
              discountPercent: l.oilDiscountPercent,
              importPercent: l.oilImportPercent,
            }
          : null,
        history: await stockHistory(tx, { fragranceId: id }, owner, WAREHOUSE_HISTORY_LIMIT),
      };
    };
    return db === this.db
      ? this.db.transaction(read, { isolationLevel: 'repeatable read' })
      : read(db);
  }

  /** An oil receipt: its grams join the oil balance. */
  async receiveOil(
    actor: StaffRow,
    fragranceId: number,
    input: OilReceiptInput,
  ): Promise<WarehouseOutcome<OilReceipt>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const f = await lockFragrance(tx, fragranceId);
        if (!f) return notFound;
        const [r] = await tx
          .insert(oilReceipts)
          .values({ fragranceId, ...oilReceiptColumns(input) })
          .returning();
        await this.received(tx, actor, f, r!, false);
        return { ok: true, value: oilReceiptOut(r!) } as const;
      }),
    );
  }

  /**
   * An oil receipt's oil joins the balance (the fragrance row is locked): the stock move and the
   * audit entry, the same for a new oil receipt and a confirmed draft.
   */
  private async received(
    tx: DbOrTx,
    actor: StaffRow,
    f: { id: number; name: string; oilMg: number },
    r: OilReceiptRow,
    fromDraft: boolean,
  ) {
    await tx
      .update(fragrances)
      .set({ oilMg: f.oilMg + r.oilMg })
      .where(eq(fragrances.id, f.id));
    const actorRef = { type: 'staff' as const, id: actor.id };
    await recordStockMove(tx, {
      fragranceId: f.id,
      kind: 'oil_receipt',
      actor: actorRef,
      oilMg: r.oilMg,
      oilReceiptId: r.id,
      details: { invoice: r.invoice, supplier: r.supplier },
    });
    await this.audit.record(tx, {
      actor: actorRef,
      action: 'warehouse.oil_received',
      targetType: 'oil_receipt',
      targetId: r.id,
      payload: {
        fragrance: f.name,
        supplier: r.supplier,
        invoice: r.invoice,
        receivedOn: r.receivedOn,
        grams: gramsFromMg(r.oilMg),
        pricePerGram: r.pricePerGram,
        discountPercent: r.discountPercent,
        importPercent: r.importPercent,
        ...(fromDraft ? { fromDraft: true } : {}),
      },
    });
  }

  /**
   * «Buy this» on the purchase plan (#78): a draft oil receipt per fragrance, the planned grams at its
   * oil price with the settings' discount and import, dated today, supplier from the fragrance.
   * Drafts hold no oil. Refused (422) for a fragrance that is gone or has no oil price.
   */
  async draftOilReceipts(
    actor: StaffRow,
    body: OilReceiptDraftsBody,
  ): Promise<WarehouseOutcome<{ created: number }>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: fragrances.id,
            name: fragrances.name,
            oilPrice: fragrances.oilPrice,
            oilSupplier: fragrances.oilSupplier,
          })
          .from(fragrances)
          .where(
            inArray(
              fragrances.id,
              body.lines.map((l) => l.fragranceId),
            ),
          );
        const byId = new Map(rows.map((r) => [r.id, r]));
        const fields = body.lines.flatMap((l, i) =>
          byId.get(l.fragranceId)?.oilPrice != null ? [] : [`lines.${i}.fragranceId`],
        );
        if (fields.length) return { ok: false, reason: 'invalid', fields } as const;
        const { liquid } = await readCostSettings(tx);
        const today = formatLocalDate(tashkentDay(this.edges.clock.now()));
        // ascending fragrance id, the order every fragrance lock is taken in (the key checks)
        const lines = [...body.lines].sort((a, b) => a.fragranceId - b.fragranceId);
        await tx.insert(oilReceipts).values(
          lines.map((l) => {
            const f = byId.get(l.fragranceId)!;
            return {
              fragranceId: f.id,
              draft: true,
              supplier: f.oilSupplier ?? '',
              invoice: '',
              receivedOn: today,
              oilMg: mgFromGrams(l.grams),
              pricePerGram: f.oilPrice!,
              discountPercent: liquid.oilDiscountPercent,
              importPercent: liquid.oilImportPercent,
            };
          }),
        );
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'warehouse.oil_receipt_drafts_created',
          targetType: 'warehouse',
          payload: {
            count: body.lines.length,
            grams: gramsFromMg(body.lines.reduce((a, l) => a + mgFromGrams(l.grams), 0)),
            fragrances: body.lines.map((l) => byId.get(l.fragranceId)!.name),
          },
        });
        return { ok: true, value: { created: body.lines.length } } as const;
      }),
    );
  }

  /** A draft confirmed as the invoice reads: it becomes an oil receipt, its grams join the balance. */
  async confirmOilReceipt(
    actor: StaffRow,
    oilReceiptId: number,
    input: OilReceiptInput,
  ): Promise<WarehouseOutcome<OilReceipt>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const locked = await lockOilReceipt(tx, oilReceiptId);
        if (!locked) return notFound;
        if (!locked.oilReceipt.draft) return { ok: false, reason: 'not_draft' } as const;
        const [r] = await tx
          .update(oilReceipts)
          .set({ ...oilReceiptColumns(input), draft: false, updatedAt: this.edges.clock.now() })
          .where(eq(oilReceipts.id, oilReceiptId))
          .returning();
        await this.received(tx, actor, locked.fragrance, r!, true);
        return { ok: true, value: oilReceiptOut(r!) } as const;
      }),
    );
  }

  /** A draft dropped: it never held oil, so nothing else moves. */
  async discardOilReceipt(
    actor: StaffRow,
    oilReceiptId: number,
  ): Promise<WarehouseOutcome<{ discarded: true }>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const locked = await lockOilReceipt(tx, oilReceiptId);
        if (!locked) return notFound;
        const { oilReceipt: r, fragrance: f } = locked;
        if (!r.draft) return { ok: false, reason: 'not_draft' } as const;
        await tx
          .delete(oilReceipts)
          .where(and(eq(oilReceipts.id, oilReceiptId), eq(oilReceipts.draft, true)));
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'warehouse.oil_receipt_draft_discarded',
          targetType: 'oil_receipt',
          targetId: oilReceiptId,
          payload: { fragrance: f.name, grams: gramsFromMg(r.oilMg) },
        });
        return { ok: true, value: { discarded: true as const } } as const;
      }),
    );
  }

  /**
   * An oil receipt rewritten with a reason: the balance moves by the change in grams. Refused while
   * the balance holds less than a smaller oil receipt would take back (the oil went into bottles).
   */
  async correctOilReceipt(
    actor: StaffRow,
    oilReceiptId: number,
    input: OilReceiptCorrection,
  ): Promise<WarehouseOutcome<OilReceipt>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const locked = await lockOilReceipt(tx, oilReceiptId);
        if (!locked) return notFound;
        const { oilReceipt: old, fragrance: f } = locked;
        if (old.draft) return { ok: false, reason: 'draft' } as const;
        if (old.voidedAt) return { ok: false, reason: 'voided' } as const;
        const { reason, ...rest } = input;
        const cols = oilReceiptColumns(rest);
        const change = cols.oilMg - old.oilMg;
        if (f.oilMg + change < 0) return short(-change, f.oilMg);
        const [r] = await tx
          .update(oilReceipts)
          .set({ ...cols, updatedAt: this.edges.clock.now() })
          .where(eq(oilReceipts.id, oilReceiptId))
          .returning();
        if (change !== 0)
          await tx
            .update(fragrances)
            .set({ oilMg: f.oilMg + change })
            .where(eq(fragrances.id, f.id));
        const actorRef = { type: 'staff' as const, id: actor.id };
        await recordStockMove(tx, {
          fragranceId: f.id,
          kind: 'oil_receipt_corrected',
          actor: actorRef,
          oilMg: change,
          oilReceiptId,
          reason,
          details: { invoice: cols.invoice, supplier: cols.supplier },
        });
        const before = oilReceiptOut(old);
        const diff: Record<string, [unknown, unknown]> = {};
        for (const k of [
          'supplier',
          'invoice',
          'receivedOn',
          'grams',
          'pricePerGram',
          'discountPercent',
          'importPercent',
        ] as const) {
          if (before[k] !== rest[k]) diff[k] = [before[k], rest[k]];
        }
        await this.audit.record(tx, {
          actor: actorRef,
          action: 'warehouse.oil_receipt_corrected',
          targetType: 'oil_receipt',
          targetId: oilReceiptId,
          payload: { fragrance: f.name, invoice: cols.invoice, reason, ...diff },
        });
        return { ok: true, value: oilReceiptOut(r!) } as const;
      }),
    );
  }

  /** An oil receipt voided with a reason: its grams leave the balance, if they are still there. */
  async voidOilReceipt(
    actor: StaffRow,
    oilReceiptId: number,
    reason: string,
  ): Promise<WarehouseOutcome<OilReceipt>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const locked = await lockOilReceipt(tx, oilReceiptId);
        if (!locked) return notFound;
        const { oilReceipt: old, fragrance: f } = locked;
        if (old.draft) return { ok: false, reason: 'draft' } as const;
        if (old.voidedAt) return { ok: false, reason: 'voided' } as const;
        if (f.oilMg < old.oilMg) return short(old.oilMg, f.oilMg);
        const now = this.edges.clock.now();
        const [r] = await tx
          .update(oilReceipts)
          .set({ voidedAt: now, voidReason: reason, updatedAt: now })
          .where(eq(oilReceipts.id, oilReceiptId))
          .returning();
        await tx
          .update(fragrances)
          .set({ oilMg: f.oilMg - old.oilMg })
          .where(eq(fragrances.id, f.id));
        const actorRef = { type: 'staff' as const, id: actor.id };
        await recordStockMove(tx, {
          fragranceId: f.id,
          kind: 'oil_receipt_voided',
          actor: actorRef,
          oilMg: -old.oilMg,
          oilReceiptId,
          reason,
          details: { invoice: old.invoice, supplier: old.supplier },
        });
        await this.audit.record(tx, {
          actor: actorRef,
          action: 'warehouse.oil_receipt_voided',
          targetType: 'oil_receipt',
          targetId: oilReceiptId,
          payload: {
            fragrance: f.name,
            supplier: old.supplier,
            invoice: old.invoice,
            grams: gramsFromMg(old.oilMg),
            reason,
          },
        });
        return { ok: true, value: oilReceiptOut(r!) } as const;
      }),
    );
  }

  /** A set assembly (`assembleDiscoverySet`), retried once on a deadlock. */
  async assembleSet(
    actor: StaffRow,
    vialMl: DiscoveryVialMl,
    quantity: number,
  ): Promise<WarehouseOutcome<SetAssemblyResult>> {
    return transient(() =>
      this.db.transaction((tx) => assembleDiscoverySet(tx, this.audit, actor, vialMl, quantity)),
    );
  }

  /**
   * A mixing (ADR 0043): `ml` of ready concentrate made from the fragrance's oil and the ethanol,
   * by the cost model's shares at the settings of now, no filling loss. The fragrance is locked
   * first, then the ethanol item; refused with the shortfall when either holds less (oil first),
   * and nothing written. Otherwise oil and ethanol fall and the concentrate rises, in one move.
   */
  async mix(
    actor: StaffRow,
    fragranceId: number,
    ml: number,
  ): Promise<WarehouseOutcome<MixingResult>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const f = await lockFragrance(tx, fragranceId);
        if (!f) return notFound;
        const locked = await lockStock(tx, { fragranceIds: [], links: [linkOf('ethanol', null)] });
        const ethanol = locked.consumables.get(linkOf('ethanol', null)) ?? null;
        const need = mixingNeeds(ml, locked.liquid);
        if (need.oilMg > f.oilMg) return short(need.oilMg, f.oilMg);
        const balanceMl = ethanol?.onHand ?? 0;
        if (need.ethanolMl > balanceMl)
          return {
            ok: false,
            reason: 'ethanol_short',
            neededMl: need.ethanolMl,
            balanceMl,
          } as const;

        const oilLeft = f.oilMg - need.oilMg;
        const madeUl = ulFromMl(ml);
        const concentrateUl = f.concentrateUl + madeUl;
        await tx
          .update(fragrances)
          .set({ oilMg: oilLeft, concentrateUl })
          .where(eq(fragrances.id, fragranceId));
        if (ethanol && need.ethanolMl > 0)
          await tx
            .update(consumables)
            .set({ onHand: ethanol.onHand - need.ethanolMl, updatedAt: this.edges.clock.now() })
            .where(eq(consumables.id, ethanol.id));
        const actorRef = { type: 'staff' as const, id: actor.id };
        const l = locked.liquid;
        await recordStockMove(tx, {
          fragranceId,
          kind: 'mixing',
          actor: actorRef,
          oilMg: -need.oilMg,
          concentrateUl: madeUl,
          consumables: ethanol ? { [ethanol.id]: -need.ethanolMl } : {},
          details: { ml, ethanolMl: need.ethanolMl },
        });
        await this.audit.record(tx, {
          actor: actorRef,
          action: 'warehouse.mixed',
          targetType: 'fragrance',
          targetId: fragranceId,
          payload: {
            fragrance: f.name,
            ml,
            oilGrams: gramsFromMg(need.oilMg),
            ethanolMl: need.ethanolMl,
            // the liquid settings it was computed at, for a later look
            oilPercent: l.oilPercent,
            ethanolPercent: l.ethanolPercent,
            oilDensity: l.oilDensity,
          },
        });
        return {
          ok: true,
          value: {
            oilGrams: gramsFromMg(need.oilMg),
            ethanolMl: need.ethanolMl,
            oilLeftGrams: gramsFromMg(oilLeft),
            concentrateMl: mlFromUl(concentrateUl),
          },
        } as const;
      }),
    );
  }

  /**
   * A count of the ready concentrate from the stock page, with a reason (ADR 0043): compare-and-set
   * against `expectedMl`, a `correction` move from the stock page and an audit entry. Below the
   * reserve is allowed and flagged, as a bottle count was (ADR 0010).
   */
  async countConcentrate(
    actor: StaffRow,
    fragranceId: number,
    body: ConcentrateCountBody,
  ): Promise<WarehouseOutcome<WarehouseFragrance>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const f = await lockFragrance(tx, fragranceId);
        if (!f) return notFound;
        if (body.expectedMl !== undefined && ulFromMl(body.expectedMl) !== f.concentrateUl)
          return { ok: false, reason: 'changed', currentUl: f.concentrateUl } as const;
        const to = ulFromMl(body.ml);
        if (to !== f.concentrateUl) {
          await tx.update(fragrances).set({ concentrateUl: to }).where(eq(fragrances.id, f.id));
          const actorRef = { type: 'staff' as const, id: actor.id };
          await recordStockMove(tx, {
            fragranceId: f.id,
            kind: 'correction',
            actor: actorRef,
            concentrateUl: to - f.concentrateUl,
            reason: body.reason,
            details: { source: 'stock' },
          });
          await this.audit.record(tx, {
            actor: actorRef,
            action: 'warehouse.concentrate_corrected',
            targetType: 'fragrance',
            targetId: f.id,
            payload: {
              fragrance: f.name,
              concentrateMl: [mlFromUl(f.concentrateUl), body.ml],
              reason: body.reason,
            },
          });
        }
        return { ok: true, value: (await this.get(f.id, actor, tx))! } as const;
      }),
    );
  }
}

/**
 * A set assembly (ADR 0043, replacing #79's set bottling): `quantity` boxes of a Discovery set
 * packed from its five fragrances' ready concentrate, one fill of the set's vial ml from each per
 * box, and a flacon of that ml per vial. In one transaction, in the one lock order: the five
 * fragrances (ascending id), the set row, the flacon; each fragrance's free concentrate (less what
 * orders hold) must cover its fills, else refused naming the first short one in the set's order.
 * The flacons never refuse: a shortfall stops at zero and asks for a recount. A `set_assembly` move
 * per fragrance; the set's boxes on hand rise. Refused while the set is not five.
 */
export async function assembleDiscoverySet(
  tx: DbOrTx,
  audit: AuditService,
  actor: StaffRow,
  vialMl: DiscoveryVialMl,
  quantity: number,
): Promise<WarehouseOutcome<SetAssemblyResult>> {
  const composition = await readComposition(tx, vialMl);
  if (composition.length !== SET_SIZE)
    return { ok: false, reason: 'invalid', fields: ['composition'] } as const;
  const ids = composition.map((f) => f.id);
  const locked = await lockStock(tx, {
    fragranceIds: ids,
    setMls: [vialMl],
    links: [linkOf('flacon', vialMl)],
  });
  const stock = await readLiquidStock(tx, ids);
  const need = quantity * fillUl(vialMl, locked.liquid);
  // in the set's own order, so the first short one named is the one the owner sees first
  for (const { id, name } of composition) {
    if (need > stock.free(id))
      return {
        ok: false,
        reason: 'concentrate_short',
        neededUl: need,
        balanceUl: stock.free(id),
        fragrance: name,
      } as const;
  }
  const before = locked.sets.get(vialMl)!.onHand;
  const actorRef = { type: 'staff' as const, id: actor.id };
  const applied = await applyStock(tx, locked, {
    fills: ids.map((fragranceId) => ({ fragranceId, ml: vialMl, qty: quantity, boxed: false })),
    sign: -1,
    sets: [{ vialMl, change: quantity }],
    move: { kind: 'set_assembly', actor: actorRef, details: { set: { vialMl, quantity } } },
  });
  const onHand = locked.sets.get(vialMl)!.onHand;
  const flacons = applied.consumables.reduce((a, c) => a + (c.from - c.to), 0);
  await audit.record(tx, {
    actor: actorRef,
    action: 'warehouse.set_assembled',
    targetType: 'discovery_set',
    targetId: DISCOVERY_SETS[vialMl].key,
    payload: {
      vialMl,
      quantity,
      onHand: [before, onHand],
      fragrances: composition.map((f) => f.name),
      concentrateMl: mlFromUl(need),
      flacons,
    },
  });
  return { ok: true, value: { concentrateMl: mlFromUl(need), flacons, onHand } } as const;
}

/** The fragrance row under the warehouse's lock; null when there is none. */
async function lockFragrance(tx: DbOrTx, id: number) {
  const [f] = await tx
    .select({
      id: fragrances.id,
      name: fragrances.name,
      oilMg: fragrances.oilMg,
      concentrateUl: fragrances.concentrateUl,
    })
    .from(fragrances)
    .where(eq(fragrances.id, id))
    .for('no key update');
  return f ?? null;
}

/** An oil receipt and its fragrance, locked fragrance first (the warehouse's one order). */
async function lockOilReceipt(tx: DbOrTx, oilReceiptId: number) {
  const [peek] = await tx
    .select({ fragranceId: oilReceipts.fragranceId })
    .from(oilReceipts)
    .where(eq(oilReceipts.id, oilReceiptId));
  if (!peek) return null;
  const fragrance = await lockFragrance(tx, peek.fragranceId);
  const [oilReceipt] = await tx
    .select()
    .from(oilReceipts)
    .where(eq(oilReceipts.id, oilReceiptId))
    .for('update');
  if (!fragrance || !oilReceipt) return null;
  return { fragrance, oilReceipt };
}

/**
 * Stock moves as history lines, newest first (ADR 0041, 0043): a fragrance's, a consumable's (the
 * moves that name it), or all. Who did it (a staff name, or none for the shop itself), the order of
 * a sale or return, Uzum's order number of an Uzum sale or its void (#80), the invoice and supplier
 * of an oil receipt, the consumables it moved and what it found short. The invoice and supplier are
 * purchase records, the owner's (ADR 0041): without `withOilReceipts` they are left out.
 */
export async function stockHistory(
  tx: DbOrTx,
  of: { fragranceId: number } | { consumableId: number } | null,
  withOilReceipts: boolean,
  limit?: number,
): Promise<StockMove[]> {
  const q = tx
    .select({
      move: stockMoves,
      staffName: staff.name,
      orderNumber: orders.number,
      fragranceName: fragrances.name,
    })
    .from(stockMoves)
    .leftJoin(staff, sql`${stockMoves.actorType} = 'staff' and ${stockMoves.actorId} = ${staff.id}`)
    .leftJoin(orders, eq(orders.id, stockMoves.orderId))
    .leftJoin(fragrances, eq(fragrances.id, stockMoves.fragranceId))
    .where(
      of === null
        ? undefined
        : 'fragranceId' in of
          ? eq(stockMoves.fragranceId, of.fragranceId)
          : sql`${stockMoves.consumables} ? ${String(of.consumableId)}`,
    )
    .orderBy(desc(stockMoves.id));
  const rows = limit === undefined ? await q : await q.limit(limit);
  const ids = [
    ...new Set(
      rows.flatMap(({ move: m }) => {
        const d = m.details as { short?: { consumables?: Record<string, number> } };
        return [...Object.keys(m.consumables), ...Object.keys(d.short?.consumables ?? {})].map(
          Number,
        );
      }),
    ),
  ];
  const named = new Map(
    (ids.length
      ? await tx
          .select({
            id: consumables.id,
            nameRu: consumables.nameRu,
            nameUz: consumables.nameUz,
            unit: consumables.unit,
          })
          .from(consumables)
          .where(inArray(consumables.id, ids))
      : []
    ).map((c) => [c.id, c]),
  );
  const changes = (byId: Record<string, number> | undefined) =>
    Object.entries(byId ?? {})
      .map(([id, change]) => {
        const c = named.get(Number(id));
        return {
          consumableId: Number(id),
          nameRu: c?.nameRu ?? '',
          nameUz: c?.nameUz ?? '',
          unit: (c?.unit ?? 'pcs') as ConsumableUnit,
          change,
        };
      })
      .sort((a, b) => a.consumableId - b.consumableId);
  return rows.map(({ move: m, staffName, orderNumber, fragranceName }) => {
    const d = m.details as {
      invoice?: string;
      supplier?: string;
      source?: StockMove['source'];
      uzumOrder?: string;
      set?: { vialMl: number; quantity: number };
      note?: string;
      short?: { concentrateUl?: number; consumables?: Record<string, number> };
    };
    const short = d.short
      ? {
          ...(d.short.concentrateUl ? { concentrateMl: mlFromUl(d.short.concentrateUl) } : {}),
          ...(d.short.consumables ? { consumables: changes(d.short.consumables) } : {}),
        }
      : null;
    return {
      id: m.id,
      fragranceId: m.fragranceId,
      fragranceName: fragranceName ?? null,
      at: m.createdAt.toISOString(),
      kind: m.kind,
      oilGrams: gramsFromMg(m.oilMg),
      concentrateMl: mlFromUl(m.concentrateUl),
      bottles: Object.entries(m.bottles)
        .map(([ml, change]) => ({ ml: Number(ml), change }))
        .sort((a, b) => a.ml - b.ml),
      consumables: changes(m.consumables),
      short,
      reason: m.reason,
      actorName: staffName ?? null,
      invoice: withOilReceipts ? (d.invoice ?? null) : null,
      supplier: withOilReceipts ? (d.supplier ?? null) : null,
      orderNumber: orderNumber ?? null,
      uzumOrder: d.uzumOrder ?? null,
      set: d.set ?? null,
      source: d.source ?? null,
      note: d.note ?? null,
    };
  });
}
