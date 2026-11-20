import type { Builder, DiscoverySet } from '@lummi/contracts';
import { SET_SIZE, SET_VIAL_ML, type DiscoveryVialMl } from '@lummi/contracts/constants';
import type { Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { DB } from '../tokens';
import { loadDiscovery, readDiscoverySet, tenMlOf } from './sets';

/** The sets the customer sees (ADR 0009, 0042): the two Discovery sets, each at its own price, and the builder at the 5 × 10 ml one's. */
@Injectable()
export class SetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async discovery(vialMl: DiscoveryVialMl): Promise<DiscoverySet> {
    const { row, composition, available } = await loadDiscovery(this.db, vialMl);
    return {
      vialMl,
      price: row.price,
      available,
      soldOut: available === 0,
      photo: row.photoHash,
      uzumUrl: row.uzumUrl,
      // The box stays on sale on its own stock, but a fragrance hidden from the catalog shows as
      // its name and attribution only: no card to open, no notes to read.
      fragrances: composition.map((f) => ({
        slug: f.hidden ? null : f.slug,
        name: f.name,
        brand: f.brand,
        keyNotes: f.hidden ? { ru: [], uz: [] } : { ru: f.keyNotesRu, uz: f.keyNotesUz },
      })),
    };
  }

  /** The fragrances the builder offers: a visible one with a 10 ml bottle available, best sellers first. */
  async builder(): Promise<Builder> {
    const [row, rank, tenMl] = await Promise.all([
      readDiscoverySet(this.db, SET_VIAL_ML),
      this.catalog.topSellersOrder(),
      tenMlOf(this.db, { all: true }),
    ]);
    const offered = new Set(tenMl.filter((t) => t.available > 0).map((t) => t.fragranceId));
    // `rank` holds every visible fragrance in top-sellers order
    const ids = rank.filter((id) => offered.has(id));
    return { price: row.price, size: SET_SIZE, options: await this.catalog.listItems(ids) };
  }
}
