import type { AdminDiscoverySet, DiscoverySetInput } from '@lummi/contracts';
import type { DiscoveryVialMl } from '@lummi/contracts/constants';
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
import { discoveryTarget, loadDiscovery, readComposition, readDiscoverySet } from '../sets/sets';
import { DB, EDGES } from '../tokens';
import type { Outcome } from './catalog-admin.service';

/**
 * Each Discovery set's price, composition, photo and own on hand (ADR 0009, 0042); the builder
 * shares the 5 × 10 ml set's price. Audit entries name the set by its vial ml (`targetId`).
 */
@Injectable()
export class SetsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(vialMl: DiscoveryVialMl, db: DbOrTx = this.db): Promise<AdminDiscoverySet> {
    const { row, composition, reserved, available } = await loadDiscovery(db, vialMl);
    return {
      vialMl,
      price: row.price,
      onHand: row.onHand,
      reserved,
      // the same not-for-sale rule as the shop: fewer than five fragrances sells nothing
      available,
      belowReserve: belowReserve(row.onHand, reserved),
      photo: row.photoHash,
      uzumUrl: row.uzumUrl,
      isPlaceholder: row.isPlaceholder,
      composition: composition.map((f) => ({ id: f.id, name: f.name, hidden: f.hidden })),
    };
  }

  /** The owner's edit: price and the five fragrances in order. One audit entry with the old and new. */
  async update(
    actor: StaffRow,
    vialMl: DiscoveryVialMl,
    input: DiscoverySetInput,
  ): Promise<Outcome<AdminDiscoverySet>> {
    return this.db.transaction(async (tx) => {
      const found = await tx
        .select({ id: fragrances.id })
        .from(fragrances)
        .where(inArray(fragrances.id, input.composition));
      if (found.length !== input.composition.length) {
        return { ok: false, reason: 'invalid', fields: ['composition'] } as const;
      }
      const old = await readDiscoverySet(tx, vialMl, true);
      const before = await readComposition(tx, vialMl);
      await tx.delete(discoverySetItems).where(eq(discoverySetItems.vialMl, vialMl));
      await tx
        .insert(discoverySetItems)
        .values(
          input.composition.map((fragranceId, i) => ({ vialMl, position: i + 1, fragranceId })),
        );
      await tx
        .update(discoverySet)
        .set({
          price: input.price,
          ...(input.uzumUrl === undefined ? {} : { uzumUrl: input.uzumUrl || null }),
          // any owner save of the price is a real decision, even confirming the seed value
          isPlaceholder: false,
          updatedAt: this.edges.clock.now(),
        })
        .where(eq(discoverySet.vialMl, vialMl));
      const after = await readComposition(tx, vialMl);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_changed',
        targetType: 'discovery_set',
        targetId: discoveryTarget(vialMl),
        payload: {
          price: [old.price, input.price],
          ...(input.uzumUrl === undefined ? {} : { uzumUrl: [old.uzumUrl, input.uzumUrl || null] }),
          composition: [before.map((f) => f.name), after.map((f) => f.name)],
        },
      });
      return { ok: true, value: await this.get(vialMl, tx) } as const;
    });
  }

  /** Same rule as a volume's count (`CatalogAdminService.setOnHand`): `expected` guards a concurrent edit; below the reserve is allowed. */
  async setOnHand(
    actor: StaffRow,
    vialMl: DiscoveryVialMl,
    onHand: number,
    expected: number | undefined,
    reason: string,
  ): Promise<Outcome<AdminDiscoverySet>> {
    return this.db.transaction(async (tx) => {
      const old = await readDiscoverySet(tx, vialMl, true);
      if (expected !== undefined && old.onHand !== expected) {
        return { ok: false, reason: 'on_hand_changed', current: old.onHand } as const;
      }
      await tx
        .update(discoverySet)
        .set({ onHand, updatedAt: this.edges.clock.now() })
        .where(eq(discoverySet.vialMl, vialMl));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_on_hand_changed',
        targetType: 'discovery_set',
        targetId: discoveryTarget(vialMl),
        payload: { onHand: [old.onHand, onHand], reason },
      });
      return { ok: true, value: await this.get(vialMl, tx) } as const;
    });
  }

  /** Same WebP pipeline as the bottle photos (the original bytes are kept). */
  async setPhoto(
    actor: StaffRow,
    vialMl: DiscoveryVialMl,
    bytes: Uint8Array,
  ): Promise<Outcome<string>> {
    const stored = await storeUploadedPhoto(this.edges.files, bytes);
    if (!stored) return { ok: false, reason: 'invalid' };
    const hash = stored.hash;
    return this.db.transaction(async (tx) => {
      const old = await readDiscoverySet(tx, vialMl, true);
      await tx
        .update(discoverySet)
        .set({ photoHash: hash, updatedAt: this.edges.clock.now() })
        .where(eq(discoverySet.vialMl, vialMl));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'sets.discovery_photo_uploaded',
        targetType: 'discovery_set',
        targetId: discoveryTarget(vialMl),
        payload: { photo: [old.photoHash, hash] },
      });
      return { ok: true, value: hash } as const;
    });
  }
}
