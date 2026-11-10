import type { Builder, DiscoverySet } from '@lummi/contracts';
import { and, eq, fragrances, volumes, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { available, CatalogService, reservedByVolume } from '../catalog/catalog.service';
import { DB } from '../tokens';
import { discoveryAvailable, readComposition, readDiscoverySet, reservedDiscovery } from './sets';

/** The two kinds of set the customer sees (ADR 0009). Both cost the Discovery set's price. */
@Injectable()
export class SetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async discovery(): Promise<DiscoverySet> {
    const [row, composition, reserved] = await Promise.all([
      readDiscoverySet(this.db),
      readComposition(this.db),
      reservedDiscovery(this.db),
    ]);
    const left = discoveryAvailable(row, reserved, composition.length);
    return {
      price: row.price,
      available: left,
      soldOut: left === 0,
      photo: row.photoHash,
      fragrances: composition.map((f) => ({
        slug: f.slug,
        name: f.name,
        brand: f.brand,
        keyNotes: { ru: f.keyNotesRu, uz: f.keyNotesUz },
      })),
    };
  }

  /** The fragrances the builder offers: a visible one with a 10 ml bottle available, best sellers first. */
  async builder(): Promise<Builder> {
    const [row, rank, tenMl] = await Promise.all([
      readDiscoverySet(this.db),
      this.catalog.topSellersOrder(),
      this.db
        .select({
          fragranceId: fragrances.id,
          volumeId: volumes.id,
          onHand: volumes.onHand,
        })
        .from(volumes)
        .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
        .where(and(eq(volumes.ml, 10), eq(fragrances.hidden, false))),
    ]);
    const reserved = await reservedByVolume(
      this.db,
      tenMl.map((v) => v.volumeId),
    );
    const offered = new Set(
      tenMl
        .filter((v) => available(v.onHand, reserved.get(v.volumeId) ?? 0) > 0)
        .map((v) => v.fragranceId),
    );
    // `rank` holds every visible fragrance in top-sellers order
    const ids = rank.filter((id) => offered.has(id));
    return { price: row.price, size: 5, options: await this.catalog.listItems(ids) };
  }
}
