import type { AdminDiscoverySet, DiscoverySetInput, NewDiscoverySet } from '@lummi/contracts';
import { asDiscoveryVialMl, MAIN_SET_KEY } from '@lummi/contracts/constants';
import {
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  inArray,
  sql,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { belowReserve } from '../catalog/catalog.service';
import { storeUploadedPhoto } from '../catalog/photo-pipeline';
import type { Edges } from '../edges';
import {
  findDiscoverySet,
  listDiscoverySets,
  readComposition,
  withState,
  type DiscoveryState,
} from '../sets/sets';
import { DB, EDGES } from '../tokens';
import type { Outcome } from './catalog-admin.service';

/**
 * Each Discovery set's name, price, composition, photo and own on hand (ADR 0009, 0042, 0044); the
 * owner adds sets and takes them off sale, never the main one, whose price the builder shares.
 * Audit entries name the set by its key (`targetId`).
 */
@Injectable()
export class SetsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Every set, hidden ones too, in the owner's order. */
  async list(): Promise<AdminDiscoverySet[]> {
    const rows = await listDiscoverySets(this.db);
    return Promise.all(rows.map(async (row) => toAdmin(await withState(this.db, row))));
  }

  /** One set; null for a key no set has. */
  async get(key: string, db: DbOrTx = this.db): Promise<AdminDiscoverySet | null> {
    const row = await findDiscoverySet(db, key);
    return row ? toAdmin(await withState(db, row)) : null;
  }

  /**
   * A new set (ADR 0044): the next free `set-<n>` key, last in the order, no boxes yet; its price
   * is the owner's from the start. One audit entry.
   */
  async create(actor: StaffRow, input: NewDiscoverySet): Promise<Outcome<AdminDiscoverySet>> {
    return this.db.transaction(async (tx) => {
      if (!(await allExist(tx, input.composition))) {
        return { ok: false, reason: 'invalid', fields: ['composition'] } as const;
      }
      // two creates at once must not pick the same key
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('discovery_set.create'))`);
      const { rows } = await tx.execute<{ n: number; position: number }>(sql`
        select
          coalesce(max(substring(key from 5)::int) filter (where key ~ '^set-[0-9]+$'), 2) + 1 as n,
          coalesce(max(position), -1) + 1 as position
        from discovery_set`);
      const key = `set-${rows[0]!.n}`;
      await tx.insert(discoverySet).values({
        key,
        vialMl: input.vialMl,
        nameRu: input.name.ru,
        nameUz: input.name.uz,
        position: Number(rows[0]!.position),
        hidden: input.hidden,
        price: input.price,
        uzumUrl: input.uzumUrl || null,
        isPlaceholder: false,
      });
      await tx.insert(discoverySetItems).values(
        input.composition.map((fragranceId, i) => ({
          setKey: key,
          position: i + 1,
          fragranceId,
        })),
      );
      const after = await readComposition(tx, key);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_created',
        targetType: 'discovery_set',
        targetId: key,
        payload: {
          vialMl: input.vialMl,
          name: input.name,
          price: input.price,
          hidden: input.hidden,
          composition: after.map((f) => f.name),
        },
      });
      return { ok: true, value: (await this.get(key, tx))! } as const;
    });
  }

  /** The owner's edit: name, price, on sale or not, and the five fragrances in order. One audit entry with the old and new. */
  async update(
    actor: StaffRow,
    key: string,
    input: DiscoverySetInput,
  ): Promise<Outcome<AdminDiscoverySet> | { ok: false; reason: 'not_found' }> {
    if (input.hidden && key === MAIN_SET_KEY) {
      return { ok: false, reason: 'invalid', fields: ['hidden'] };
    }
    return this.db.transaction(async (tx) => {
      if (!(await allExist(tx, input.composition))) {
        return { ok: false, reason: 'invalid', fields: ['composition'] } as const;
      }
      const old = await findDiscoverySet(tx, key, true);
      if (!old) return { ok: false, reason: 'not_found' } as const;
      const before = await readComposition(tx, key);
      await tx.delete(discoverySetItems).where(eq(discoverySetItems.setKey, key));
      await tx.insert(discoverySetItems).values(
        input.composition.map((fragranceId, i) => ({
          setKey: key,
          position: i + 1,
          fragranceId,
        })),
      );
      await tx
        .update(discoverySet)
        .set({
          nameRu: input.name.ru,
          nameUz: input.name.uz,
          hidden: input.hidden,
          price: input.price,
          ...(input.uzumUrl === undefined ? {} : { uzumUrl: input.uzumUrl || null }),
          // any owner save of the price is a real decision, even confirming the seed value
          isPlaceholder: false,
          updatedAt: this.edges.clock.now(),
        })
        .where(eq(discoverySet.key, key));
      const after = await readComposition(tx, key);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_changed',
        targetType: 'discovery_set',
        targetId: key,
        payload: {
          vialMl: old.vialMl,
          ...(old.nameRu === input.name.ru && old.nameUz === input.name.uz
            ? {}
            : {
                name: [
                  { ru: old.nameRu, uz: old.nameUz },
                  { ru: input.name.ru, uz: input.name.uz },
                ],
              }),
          ...(old.hidden === input.hidden ? {} : { hidden: [old.hidden, input.hidden] }),
          price: [old.price, input.price],
          ...(input.uzumUrl === undefined ? {} : { uzumUrl: [old.uzumUrl, input.uzumUrl || null] }),
          composition: [before.map((f) => f.name), after.map((f) => f.name)],
        },
      });
      return { ok: true, value: (await this.get(key, tx))! } as const;
    });
  }

  /** The boxes counted: `expected` guards a concurrent edit; below the reserve is allowed (ADR 0010). */
  async setOnHand(
    actor: StaffRow,
    key: string,
    onHand: number,
    expected: number | undefined,
    reason: string,
  ): Promise<
    | { ok: true; value: AdminDiscoverySet }
    | { ok: false; reason: 'on_hand_changed'; current: number }
    | { ok: false; reason: 'not_found' }
  > {
    return this.db.transaction(async (tx) => {
      const old = await findDiscoverySet(tx, key, true);
      if (!old) return { ok: false, reason: 'not_found' } as const;
      if (expected !== undefined && old.onHand !== expected) {
        return { ok: false, reason: 'on_hand_changed', current: old.onHand } as const;
      }
      await tx
        .update(discoverySet)
        .set({ onHand, updatedAt: this.edges.clock.now() })
        .where(eq(discoverySet.key, key));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_on_hand_changed',
        targetType: 'discovery_set',
        targetId: key,
        payload: { vialMl: old.vialMl, onHand: [old.onHand, onHand], reason },
      });
      return { ok: true, value: (await this.get(key, tx))! } as const;
    });
  }

  /** Same WebP pipeline as the bottle photos (the original bytes are kept). */
  async setPhoto(
    actor: StaffRow,
    key: string,
    bytes: Uint8Array,
  ): Promise<Outcome<string> | { ok: false; reason: 'not_found' }> {
    const stored = await storeUploadedPhoto(this.edges.files, bytes);
    if (!stored) return { ok: false, reason: 'invalid' };
    const hash = stored.hash;
    return this.db.transaction(async (tx) => {
      const old = await findDiscoverySet(tx, key, true);
      if (!old) return { ok: false, reason: 'not_found' } as const;
      await tx
        .update(discoverySet)
        .set({ photoHash: hash, updatedAt: this.edges.clock.now() })
        .where(eq(discoverySet.key, key));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_photo_uploaded',
        targetType: 'discovery_set',
        targetId: key,
        payload: { vialMl: old.vialMl, photo: [old.photoHash, hash] },
      });
      return { ok: true, value: hash } as const;
    });
  }
}

function toAdmin({ row, composition, reserved, available }: DiscoveryState): AdminDiscoverySet {
  return {
    key: row.key,
    vialMl: asDiscoveryVialMl(row.vialMl),
    name: { ru: row.nameRu, uz: row.nameUz },
    hidden: row.hidden,
    price: row.price,
    onHand: row.onHand,
    reserved,
    // the same not-for-sale rule as the shop: fewer than five fragrances, or hidden, sells nothing
    available,
    belowReserve: belowReserve(row.onHand, reserved),
    photo: row.photoHash,
    uzumUrl: row.uzumUrl,
    isPlaceholder: row.isPlaceholder,
    composition: composition.map((f) => ({ id: f.id, name: f.name, hidden: f.hidden })),
  };
}

async function allExist(db: DbOrTx, ids: readonly number[]): Promise<boolean> {
  const found = await db
    .select({ id: fragrances.id })
    .from(fragrances)
    .where(inArray(fragrances.id, [...ids]));
  return found.length === ids.length;
}
