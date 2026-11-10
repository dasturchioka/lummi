import type { AdminDiscoverySet, DiscoverySetInput } from '@lummi/contracts';
import {
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  inArray,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { belowReserve } from '../catalog/catalog.service';
import { storeUploadedPhoto } from '../catalog/photo-pipeline';
import type { Edges } from '../edges';
import { loadDiscovery, readComposition, readDiscoverySet } from '../sets/sets';
import { DB, EDGES } from '../tokens';
import type { Outcome } from './catalog-admin.service';

/** The Discovery set's price, composition, photo and own on hand; the builder shares its price (ADR 0009). */
@Injectable()
export class SetsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(db: DbOrTx = this.db): Promise<AdminDiscoverySet> {
    const { row, composition, reserved, available } = await loadDiscovery(db);
    return {
      price: row.price,
      onHand: row.onHand,
      reserved,
      // the same not-for-sale rule as the shop: fewer than five fragrances sells nothing
      available,
      belowReserve: belowReserve(row.onHand, reserved),
      photo: row.photoHash,
      isPlaceholder: row.isPlaceholder,
      composition: composition.map((f) => ({ id: f.id, name: f.name, hidden: f.hidden })),
    };
  }

  /** The owner's edit: price and the five fragrances in order. One audit entry with the old and new. */
  async update(actor: StaffRow, input: DiscoverySetInput): Promise<Outcome<AdminDiscoverySet>> {
    return this.db.transaction(async (tx) => {
      const found = await tx
        .select({ id: fragrances.id })
        .from(fragrances)
        .where(inArray(fragrances.id, input.composition));
      if (found.length !== input.composition.length) {
        return { ok: false, reason: 'invalid', fields: ['composition'] } as const;
      }
      const old = await readDiscoverySet(tx, true);
      const before = await readComposition(tx);
      await tx.delete(discoverySetItems);
      await tx
        .insert(discoverySetItems)
        .values(input.composition.map((fragranceId, i) => ({ position: i + 1, fragranceId })));
      await tx
        .update(discoverySet)
        .set({
          price: input.price,
          // any owner save of the price is a real decision, even confirming the seed value
          isPlaceholder: false,
          updatedAt: this.edges.clock.now(),
        })
        .where(eq(discoverySet.id, true));
      const after = await readComposition(tx);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_changed',
        targetType: 'discovery_set',
        targetId: 'discovery',
        payload: {
          price: [old.price, input.price],
          composition: [before.map((f) => f.name), after.map((f) => f.name)],
        },
      });
      return { ok: true, value: await this.get(tx) } as const;
    });
  }

  /** Same rule as a volume's count (`CatalogAdminService.setOnHand`): `expected` guards a concurrent edit; below the reserve is allowed. */
  async setOnHand(
    actor: StaffRow,
    onHand: number,
    expected?: number,
  ): Promise<Outcome<AdminDiscoverySet>> {
    return this.db.transaction(async (tx) => {
      const old = await readDiscoverySet(tx, true);
      if (expected !== undefined && old.onHand !== expected) {
        return { ok: false, reason: 'on_hand_changed', current: old.onHand } as const;
      }
      await tx
        .update(discoverySet)
        .set({ onHand, updatedAt: this.edges.clock.now() })
        .where(eq(discoverySet.id, true));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_on_hand_changed',
        targetType: 'discovery_set',
        targetId: 'discovery',
        payload: { onHand: [old.onHand, onHand] },
      });
      return { ok: true, value: await this.get(tx) } as const;
    });
  }

  /** Same WebP pipeline as the bottle photos (the original bytes are kept). */
  async setPhoto(actor: StaffRow, bytes: Uint8Array): Promise<Outcome<string>> {
    const stored = await storeUploadedPhoto(this.edges.files, bytes);
    if (!stored) return { ok: false, reason: 'invalid' };
    const hash = stored.hash;
    return this.db.transaction(async (tx) => {
      const old = await readDiscoverySet(tx, true);
      await tx
        .update(discoverySet)
        .set({ photoHash: hash, updatedAt: this.edges.clock.now() })
        .where(eq(discoverySet.id, true));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_photo_uploaded',
        targetType: 'discovery_set',
        targetId: 'discovery',
        payload: { photo: [old.photoHash, hash] },
      });
      return { ok: true, value: hash } as const;
    });
  }
}
