import {
  WAREHOUSE_HISTORY_LIMIT,
  type BottlingBody,
  type BottlingResult,
  type OilReceipt,
  type OilReceiptCorrection,
  type OilReceiptInput,
  type ReceiptDraftsBody,
  type StockMove,
  type WarehouseFragrance,
} from '@lummi/contracts';
import { utcToTashkent } from '@lummi/contracts';
import {
  and,
  asc,
  bottlings,
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
import { available, reservedByVolume } from '../catalog/catalog.service';
import { readCostSettings } from '../cost/cost-settings';
import { liquidNeeded } from '../cost/unit-cost';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { retryTransientOnce, TryAgainError } from '../util/transient';
import { fragranceOil, readOilContext, round3 } from './fragrance-oil';
import { bottlingNeeds, gramsFromMg, mgFromGrams, receiptCost } from './oil';
import { recordStockMove } from './stock-moves';

export type WarehouseFailure =
  | { ok: false; reason: 'not_found' | 'voided' | 'draft' | 'not_draft' | 'try_again' }
  | { ok: false; reason: 'invalid'; fields: string[] }
  /** The oil balance holds less than the operation takes. */
  | { ok: false; reason: 'oil_short'; neededMg: number; balanceMg: number };
export type WarehouseOutcome<T> = { ok: true; value: T } | WarehouseFailure;

const notFound = { ok: false, reason: 'not_found' } as const;
const short = (neededMg: number, balanceMg: number) =>
  ({ ok: false, reason: 'oil_short', neededMg, balanceMg }) as const;

/** A deadlock or serialization failure is run once more, then answered as `try_again`. */
async function transient<T>(run: () => Promise<WarehouseOutcome<T>>): Promise<WarehouseOutcome<T>> {
  try {
    return await retryTransientOnce(run);
  } catch (e) {
    if (e instanceof TryAgainError) return { ok: false, reason: 'try_again' };
    throw e;
  }
}

const isOwner = (s: StaffRow) => s.role === 'owner';

function receiptOut(r: OilReceiptRow): OilReceipt {
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
    ...receiptCost(r),
    draft: r.draft,
    voided: r.voidedAt !== null,
    voidReason: r.voidReason,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The receipt's columns from the form; grams are kept in milligrams. */
const receiptColumns = (input: OilReceiptInput) => ({
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
 * on hand. A receipt, its correction or void, and a bottling each lock the fragrance row first
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

  /** The fragrance's warehouse page; receipts, their defaults and values are the owner's only. */
  async get(id: number, viewer: StaffRow): Promise<WarehouseFragrance | null> {
    const owner = isOwner(viewer);
    return this.db.transaction(
      async (tx) => {
        const [f] = await tx.select().from(fragrances).where(eq(fragrances.id, id));
        if (!f) return null;
        const ctx = await readOilContext(tx, owner);
        const vols = await tx
          .select({ id: volumes.id, ml: volumes.ml, onHand: volumes.onHand })
          .from(volumes)
          .where(eq(volumes.fragranceId, id))
          .orderBy(asc(volumes.ml));
        const reserved = await reservedByVolume(
          tx,
          vols.map((v) => v.id),
        );
        const receipts = await tx
          .select()
          .from(oilReceipts)
          .where(eq(oilReceipts.fragranceId, id))
          .orderBy(desc(oilReceipts.id));
        const standing = receipts.filter((r) => r.voidedAt === null && !r.draft);
        const drafts = owner ? receipts.filter((r) => r.draft).length : 0;
        return {
          fragranceId: f.id,
          name: f.name,
          hidden: f.hidden,
          oil: fragranceOil(f, standing, vols, ctx, drafts),
          lowOilLitres: ctx.lowOilLitres,
          volumes: vols.map((v) => {
            const held = reserved.get(v.id) ?? 0;
            return {
              volumeId: v.id,
              ml: v.ml,
              onHand: v.onHand,
              reserved: held,
              available: available(v.onHand, held),
            };
          }),
          perBottle: vols.map((v) => {
            const each = liquidNeeded(v.ml, ctx.costs.liquid);
            return { ml: v.ml, oilGrams: round3(each.oilGrams), ethanolMl: round3(each.ethanolMl) };
          }),
          receipts: owner ? receipts.map(receiptOut) : null,
          receiptDefaults: owner
            ? {
                supplier: f.oilSupplier,
                pricePerGram: f.oilPrice,
                discountPercent: ctx.costs.liquid.oilDiscountPercent,
                importPercent: ctx.costs.liquid.oilImportPercent,
              }
            : null,
          history: await stockHistory(tx, id, WAREHOUSE_HISTORY_LIMIT),
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /** An oil receipt: its grams join the oil balance. */
  async receive(
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
          .values({ fragranceId, ...receiptColumns(input) })
          .returning();
        await this.received(tx, actor, f, r!, false);
        return { ok: true, value: receiptOut(r!) } as const;
      }),
    );
  }

  /**
   * A receipt's oil joins the balance (the fragrance row is locked): the stock move and the audit
   * entry, the same for a new receipt and a confirmed draft.
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
      kind: 'receipt',
      actor: actorRef,
      oilMg: r.oilMg,
      receiptId: r.id,
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
   * «Buy this» on the purchase plan (#78): a draft receipt per fragrance, the planned grams at its
   * oil price with the settings' discount and import, dated today, supplier from the fragrance.
   * Drafts hold no oil. Refused (422) for a fragrance that is gone or has no oil price.
   */
  async draftReceipts(
    actor: StaffRow,
    body: ReceiptDraftsBody,
  ): Promise<WarehouseOutcome<{ created: number }>> {
    return this.db.transaction(async (tx) => {
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
      const d = utcToTashkent(this.edges.clock.now());
      const pad = (n: number) => String(n).padStart(2, '0');
      const today = `${d.year}-${pad(d.month)}-${pad(d.day)}`;
      await tx.insert(oilReceipts).values(
        body.lines.map((l) => {
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
        action: 'warehouse.receipt_drafts_created',
        targetType: 'warehouse',
        payload: {
          count: body.lines.length,
          grams: gramsFromMg(body.lines.reduce((a, l) => a + mgFromGrams(l.grams), 0)),
          fragrances: body.lines.map((l) => byId.get(l.fragranceId)!.name),
        },
      });
      return { ok: true, value: { created: body.lines.length } } as const;
    });
  }

  /** A draft confirmed as the invoice reads: it becomes a receipt and its grams join the balance. */
  async confirmReceipt(
    actor: StaffRow,
    receiptId: number,
    input: OilReceiptInput,
  ): Promise<WarehouseOutcome<OilReceipt>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const locked = await lockReceipt(tx, receiptId);
        if (!locked) return notFound;
        if (!locked.receipt.draft) return { ok: false, reason: 'not_draft' } as const;
        const [r] = await tx
          .update(oilReceipts)
          .set({ ...receiptColumns(input), draft: false, updatedAt: this.edges.clock.now() })
          .where(eq(oilReceipts.id, receiptId))
          .returning();
        await this.received(tx, actor, locked.fragrance, r!, true);
        return { ok: true, value: receiptOut(r!) } as const;
      }),
    );
  }

  /** A draft dropped: it never held oil, so nothing else moves. */
  async discardReceipt(
    actor: StaffRow,
    receiptId: number,
  ): Promise<WarehouseOutcome<{ discarded: true }>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const locked = await lockReceipt(tx, receiptId);
        if (!locked) return notFound;
        const { receipt: r, fragrance: f } = locked;
        if (!r.draft) return { ok: false, reason: 'not_draft' } as const;
        await tx
          .delete(oilReceipts)
          .where(and(eq(oilReceipts.id, receiptId), eq(oilReceipts.draft, true)));
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'warehouse.receipt_draft_discarded',
          targetType: 'oil_receipt',
          targetId: receiptId,
          payload: { fragrance: f.name, grams: gramsFromMg(r.oilMg) },
        });
        return { ok: true, value: { discarded: true as const } } as const;
      }),
    );
  }

  /**
   * A receipt rewritten with a reason: the balance moves by the change in grams. Refused while the
   * balance holds less than a smaller receipt would take back (the oil went into bottles).
   */
  async correctReceipt(
    actor: StaffRow,
    receiptId: number,
    input: OilReceiptCorrection,
  ): Promise<WarehouseOutcome<OilReceipt>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const locked = await lockReceipt(tx, receiptId);
        if (!locked) return notFound;
        const { receipt: old, fragrance: f } = locked;
        if (old.draft) return { ok: false, reason: 'draft' } as const;
        if (old.voidedAt) return { ok: false, reason: 'voided' } as const;
        const { reason, ...rest } = input;
        const cols = receiptColumns(rest);
        const change = cols.oilMg - old.oilMg;
        if (f.oilMg + change < 0) return short(-change, f.oilMg);
        const [r] = await tx
          .update(oilReceipts)
          .set({ ...cols, updatedAt: this.edges.clock.now() })
          .where(eq(oilReceipts.id, receiptId))
          .returning();
        if (change !== 0)
          await tx
            .update(fragrances)
            .set({ oilMg: f.oilMg + change })
            .where(eq(fragrances.id, f.id));
        const actorRef = { type: 'staff' as const, id: actor.id };
        await recordStockMove(tx, {
          fragranceId: f.id,
          kind: 'receipt_corrected',
          actor: actorRef,
          oilMg: change,
          receiptId,
          reason,
          details: { invoice: cols.invoice, supplier: cols.supplier },
        });
        const before = receiptOut(old);
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
          action: 'warehouse.receipt_corrected',
          targetType: 'oil_receipt',
          targetId: receiptId,
          payload: { fragrance: f.name, invoice: cols.invoice, reason, ...diff },
        });
        return { ok: true, value: receiptOut(r!) } as const;
      }),
    );
  }

  /** A receipt voided with a reason: its grams leave the balance, if they are still there. */
  async voidReceipt(
    actor: StaffRow,
    receiptId: number,
    reason: string,
  ): Promise<WarehouseOutcome<OilReceipt>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const locked = await lockReceipt(tx, receiptId);
        if (!locked) return notFound;
        const { receipt: old, fragrance: f } = locked;
        if (old.draft) return { ok: false, reason: 'draft' } as const;
        if (old.voidedAt) return { ok: false, reason: 'voided' } as const;
        if (f.oilMg < old.oilMg) return short(old.oilMg, f.oilMg);
        const now = this.edges.clock.now();
        const [r] = await tx
          .update(oilReceipts)
          .set({ voidedAt: now, voidReason: reason, updatedAt: now })
          .where(eq(oilReceipts.id, receiptId))
          .returning();
        await tx
          .update(fragrances)
          .set({ oilMg: f.oilMg - old.oilMg })
          .where(eq(fragrances.id, f.id));
        const actorRef = { type: 'staff' as const, id: actor.id };
        await recordStockMove(tx, {
          fragranceId: f.id,
          kind: 'receipt_voided',
          actor: actorRef,
          oilMg: -old.oilMg,
          receiptId,
          reason,
          details: { invoice: old.invoice, supplier: old.supplier },
        });
        await this.audit.record(tx, {
          actor: actorRef,
          action: 'warehouse.receipt_voided',
          targetType: 'oil_receipt',
          targetId: receiptId,
          payload: {
            fragrance: f.name,
            supplier: old.supplier,
            invoice: old.invoice,
            grams: gramsFromMg(old.oilMg),
            reason,
          },
        });
        return { ok: true, value: receiptOut(r!) } as const;
      }),
    );
  }

  /**
   * A bottling: the oil the counts take (the cost model's `liquidNeeded`, filling loss included,
   * at the settings of now) leaves the balance and the bottles join on hand, in one transaction.
   * Refused with the shortfall when the balance holds less.
   */
  async bottle(
    actor: StaffRow,
    fragranceId: number,
    body: BottlingBody,
  ): Promise<WarehouseOutcome<BottlingResult>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const f = await lockFragrance(tx, fragranceId);
        if (!f) return notFound;
        const vols = await tx
          .select({ id: volumes.id, ml: volumes.ml, onHand: volumes.onHand })
          .from(volumes)
          .where(eq(volumes.fragranceId, fragranceId))
          .orderBy(asc(volumes.id))
          .for('update');
        const fields = body.lines.flatMap((l, i) =>
          vols.some((v) => v.ml === l.ml) ? [] : [`lines.${i}.ml`],
        );
        if (fields.length) return { ok: false, reason: 'invalid', fields } as const;

        const lines = body.lines.filter((l) => l.quantity > 0);
        const { liquid } = await readCostSettings(tx);
        const need = bottlingNeeds(lines, liquid);
        if (need.oilMg > f.oilMg) return short(need.oilMg, f.oilMg);

        const left = f.oilMg - need.oilMg;
        await tx.update(fragrances).set({ oilMg: left }).where(eq(fragrances.id, fragranceId));
        for (const l of lines) {
          const v = vols.find((x) => x.ml === l.ml)!;
          await tx
            .update(volumes)
            .set({ onHand: v.onHand + l.quantity })
            .where(eq(volumes.id, v.id));
        }
        const [b] = await tx
          .insert(bottlings)
          .values({ fragranceId, lines, oilMg: need.oilMg, ethanolMl: need.ethanolMl })
          .returning({ id: bottlings.id });
        const actorRef = { type: 'staff' as const, id: actor.id };
        await recordStockMove(tx, {
          fragranceId,
          kind: 'bottling',
          actor: actorRef,
          oilMg: -need.oilMg,
          bottles: Object.fromEntries(lines.map((l) => [l.ml, l.quantity])),
          bottlingId: b!.id,
          details: { ethanolMl: need.ethanolMl },
        });
        await this.audit.record(tx, {
          actor: actorRef,
          action: 'warehouse.bottled',
          targetType: 'fragrance',
          targetId: fragranceId,
          payload: {
            fragrance: f.name,
            lines,
            oilGrams: gramsFromMg(need.oilMg),
            ethanolMl: need.ethanolMl,
            // the liquid settings it was computed at, for a later look
            oilPercent: liquid.oilPercent,
            oilDensity: liquid.oilDensity,
            fillingLossPercent: liquid.fillingLossPercent,
          },
        });
        return {
          ok: true,
          value: {
            id: b!.id,
            oilGrams: gramsFromMg(need.oilMg),
            ethanolMl: need.ethanolMl,
            oilLeftGrams: gramsFromMg(left),
          },
        } as const;
      }),
    );
  }
}

/** The fragrance row under the warehouse's lock; null when there is none. */
async function lockFragrance(tx: DbOrTx, id: number) {
  const [f] = await tx
    .select({ id: fragrances.id, name: fragrances.name, oilMg: fragrances.oilMg })
    .from(fragrances)
    .where(eq(fragrances.id, id))
    .for('no key update');
  return f ?? null;
}

/** A receipt and its fragrance, locked fragrance first (the warehouse's one order). */
async function lockReceipt(tx: DbOrTx, receiptId: number) {
  const [peek] = await tx
    .select({ fragranceId: oilReceipts.fragranceId })
    .from(oilReceipts)
    .where(eq(oilReceipts.id, receiptId));
  if (!peek) return null;
  const fragrance = await lockFragrance(tx, peek.fragranceId);
  const [receipt] = await tx
    .select()
    .from(oilReceipts)
    .where(eq(oilReceipts.id, receiptId))
    .for('update');
  if (!fragrance || !receipt) return null;
  return { fragrance, receipt };
}

/**
 * A fragrance's stock moves as history lines, newest first: who did it (a staff name, or none for
 * the shop itself), the order of a sale or return, the invoice of a receipt.
 */
export async function stockHistory(
  tx: DbOrTx,
  fragranceId: number | null,
  limit?: number,
): Promise<(StockMove & { fragranceId: number })[]> {
  const q = tx
    .select({ move: stockMoves, staffName: staff.name, orderNumber: orders.number })
    .from(stockMoves)
    .leftJoin(staff, sql`${stockMoves.actorType} = 'staff' and ${stockMoves.actorId} = ${staff.id}`)
    .leftJoin(orders, eq(orders.id, stockMoves.orderId))
    .where(fragranceId === null ? undefined : eq(stockMoves.fragranceId, fragranceId))
    .orderBy(desc(stockMoves.id));
  const rows = limit === undefined ? await q : await q.limit(limit);
  return rows.map(({ move: m, staffName, orderNumber }) => {
    const d = m.details as { invoice?: string; supplier?: string; source?: StockMove['source'] };
    return {
      id: m.id,
      fragranceId: m.fragranceId,
      at: m.createdAt.toISOString(),
      kind: m.kind,
      oilGrams: gramsFromMg(m.oilMg),
      bottles: Object.entries(m.bottles)
        .map(([ml, change]) => ({ ml: Number(ml), change }))
        .sort((a, b) => a.ml - b.ml),
      reason: m.reason,
      actorName: staffName ?? null,
      invoice: d.invoice ?? null,
      supplier: d.supplier ?? null,
      orderNumber: orderNumber ?? null,
      source: d.source ?? null,
    };
  });
}
