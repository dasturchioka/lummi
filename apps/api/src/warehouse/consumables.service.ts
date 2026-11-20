import {
  WAREHOUSE_HISTORY_LIMIT,
  type Consumable,
  type ConsumableCountBody,
  type ConsumableHistory,
  type ConsumableInput,
  type ConsumableReceiptBody,
  type ConsumableUpdate,
  type StockLevel,
} from '@lummi/contracts';
import {
  asc,
  consumables,
  eq,
  sql,
  type ConsumableRow,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { isOwner } from '../staff/staff.guard';
import { DB, EDGES } from '../tokens';
import { retryOrTryAgain, uniqueViolation } from '../util/transient';
import { recordStockMove } from './stock-moves';
import { stockHistory } from './warehouse.service';

export type ConsumableFailure =
  | { ok: false; reason: 'not_found' | 'link_taken' | 'try_again' }
  | { ok: false; reason: 'changed'; current: number };
export type ConsumableOutcome<T> = { ok: true; value: T } | ConsumableFailure;

const notFound = { ok: false, reason: 'not_found' } as const;
const transient = <T>(run: () => Promise<ConsumableOutcome<T>>) =>
  retryOrTryAgain<ConsumableOutcome<T>>(run, { ok: false, reason: 'try_again' });

/** The item's level against its own threshold: none left, at or under it, or fine. */
export const consumableLevel = (onHand: number, low: number): StockLevel =>
  onHand <= 0 ? 'zero' : onHand <= low ? 'low' : 'ok';

/** The list's order: what is used by itself first (flacons, boxes by ml, the ethanol), then the rest. */
const USE_ORDER = sql`case ${consumables.use} when 'flacon' then 0 when 'box' then 1 when 'ethanol' then 2 else 3 end`;

export function consumableOut(c: ConsumableRow): Consumable {
  return {
    id: c.id,
    nameRu: c.nameRu,
    nameUz: c.nameUz,
    unit: c.unit,
    use: c.use,
    ml: c.ml,
    onHand: c.onHand,
    lowThreshold: c.lowThreshold,
    level: consumableLevel(c.onHand, c.lowThreshold),
    needsRecount: c.needsRecount,
    isPlaceholder: c.isPlaceholder,
    archived: c.archived,
  };
}

async function lockItem(tx: DbOrTx, id: number): Promise<ConsumableRow | null> {
  const [c] = await tx.select().from(consumables).where(eq(consumables.id, id)).for('update');
  return c ?? null;
}

/**
 * Consumables (ADR 0043): flacons, boxes, the ethanol and what staff add. Owner and manager count
 * them (ADR 0041's roles). Each change locks the item, writes it, leaves a stock move (the history)
 * and an audit entry in one transaction. The automatic uses (a handover's flacons and boxes, a
 * mixing's ethanol) are `applyStock`'s and the mixing's.
 */
@Injectable()
export class ConsumablesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EDGES) private readonly edges: Pick<Edges, 'clock'>,
  ) {}

  async list(): Promise<Consumable[]> {
    const rows = await this.db
      .select()
      .from(consumables)
      .orderBy(
        asc(consumables.archived),
        asc(USE_ORDER),
        asc(sql`coalesce(${consumables.ml}, 0)`),
        asc(consumables.id),
      );
    return rows.map(consumableOut);
  }

  async create(actor: StaffRow, input: ConsumableInput): Promise<ConsumableOutcome<Consumable>> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(consumables)
          .values({
            nameRu: input.nameRu,
            nameUz: input.nameUz,
            unit: input.unit,
            use: input.use,
            ml: input.ml,
            lowThreshold: input.lowThreshold,
          })
          .returning();
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'consumable.created',
          targetType: 'consumable',
          targetId: row!.id,
          payload: { ...input },
        });
        return { ok: true, value: consumableOut(row!) } as const;
      });
    } catch (e) {
      if (uniqueViolation(e) === 'consumables_use_ml_idx')
        return { ok: false, reason: 'link_taken' } as const;
      throw e;
    }
  }

  async update(
    actor: StaffRow,
    id: number,
    body: ConsumableUpdate,
  ): Promise<ConsumableOutcome<Consumable>> {
    try {
      return await transient(() =>
        this.db.transaction(async (tx) => {
          const old = await lockItem(tx, id);
          if (!old) return notFound;
          const [row] = await tx
            .update(consumables)
            .set({ ...body, updatedAt: this.edges.clock.now() })
            .where(eq(consumables.id, id))
            .returning();
          const diff: Record<string, [unknown, unknown]> = {};
          for (const k of ['nameRu', 'nameUz', 'lowThreshold', 'archived'] as const)
            if (old[k] !== body[k]) diff[k] = [old[k], body[k]];
          if (Object.keys(diff).length)
            await this.audit.record(tx, {
              actor: { type: 'staff', id: actor.id },
              action: 'consumable.updated',
              targetType: 'consumable',
              targetId: id,
              // the item's names as they were, both languages; what changed, each a [from, to] pair
              payload: { nameRu: old.nameRu, nameUz: old.nameUz, changes: diff },
            });
          return { ok: true, value: consumableOut(row!) } as const;
        }),
      );
    } catch (e) {
      // un-archiving an item whose link another active item took meanwhile
      if (uniqueViolation(e) === 'consumables_use_ml_idx')
        return { ok: false, reason: 'link_taken' } as const;
      throw e;
    }
  }

  /** Units received: up by the quantity, with a history line (and its note). */
  async receive(
    actor: StaffRow,
    id: number,
    body: ConsumableReceiptBody,
  ): Promise<ConsumableOutcome<Consumable>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const old = await lockItem(tx, id);
        if (!old) return notFound;
        const [row] = await tx
          .update(consumables)
          // added to a placeholder count, the total is still partly ours: only a count clears it
          .set({ onHand: old.onHand + body.quantity, updatedAt: this.edges.clock.now() })
          .where(eq(consumables.id, id))
          .returning();
        const actorRef = { type: 'staff' as const, id: actor.id };
        await recordStockMove(tx, {
          fragranceId: null,
          kind: 'consumable_received',
          actor: actorRef,
          consumables: { [id]: body.quantity },
          details: body.note ? { note: body.note } : {},
        });
        await this.audit.record(tx, {
          actor: actorRef,
          action: 'consumable.received',
          targetType: 'consumable',
          targetId: id,
          payload: {
            nameRu: old.nameRu,
            nameUz: old.nameUz,
            unit: old.unit,
            quantity: body.quantity,
            onHand: [old.onHand, row!.onHand],
            ...(body.note ? { note: body.note } : {}),
          },
        });
        return { ok: true, value: consumableOut(row!) } as const;
      }),
    );
  }

  /**
   * A count with a reason: compare-and-set against `expected`, and it clears «Пересчитайте». A
   * count that changes nothing is still audited (the recount happened) but moves nothing.
   */
  async count(
    actor: StaffRow,
    id: number,
    body: ConsumableCountBody,
  ): Promise<ConsumableOutcome<Consumable>> {
    return transient(() =>
      this.db.transaction(async (tx) => {
        const old = await lockItem(tx, id);
        if (!old) return notFound;
        if (body.expected !== undefined && body.expected !== old.onHand)
          return { ok: false, reason: 'changed', current: old.onHand } as const;
        const [row] = await tx
          .update(consumables)
          .set({
            onHand: body.onHand,
            needsRecount: false,
            isPlaceholder: false,
            updatedAt: this.edges.clock.now(),
          })
          .where(eq(consumables.id, id))
          .returning();
        const actorRef = { type: 'staff' as const, id: actor.id };
        if (body.onHand !== old.onHand)
          await recordStockMove(tx, {
            fragranceId: null,
            kind: 'consumable_corrected',
            actor: actorRef,
            consumables: { [id]: body.onHand - old.onHand },
            reason: body.reason,
          });
        await this.audit.record(tx, {
          actor: actorRef,
          action: 'consumable.corrected',
          targetType: 'consumable',
          targetId: id,
          payload: {
            nameRu: old.nameRu,
            nameUz: old.nameUz,
            unit: old.unit,
            onHand: [old.onHand, body.onHand],
            reason: body.reason,
          },
        });
        return { ok: true, value: consumableOut(row!) } as const;
      }),
    );
  }

  /** The item and the moves that name it, newest first. */
  async history(id: number, viewer: StaffRow): Promise<ConsumableHistory | null> {
    return this.db.transaction(
      async (tx) => {
        const [item] = await tx.select().from(consumables).where(eq(consumables.id, id));
        if (!item) return null;
        return {
          item: consumableOut(item),
          moves: await stockHistory(
            tx,
            { consumableId: id },
            isOwner(viewer),
            WAREHOUSE_HISTORY_LIMIT,
          ),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
