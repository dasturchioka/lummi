import type { Builder, DiscoverySet } from '@lummi/contracts';
import { asDiscoveryVialMl, MAIN_SET_KEY, SET_SIZE } from '@lummi/contracts/constants';
import type { Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { DB } from '../tokens';
import {
  findDiscoverySet,
  listDiscoverySets,
  readDiscoverySet,
  tenMlOf,
  withState,
  type DiscoveryState,
} from './sets';

/** The sets the customer sees (ADR 0009, 0042, 0044): the Discovery sets on sale, each at its own price, and the builder at the main one's. */
@Injectable()
export class SetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  /** The sets on sale (not hidden, five fragrances chosen), in the owner's order. */
  async list(): Promise<DiscoverySet[]> {
    const rows = await listDiscoverySets(this.db);
    const states = await Promise.all(
      rows.filter((r) => !r.hidden).map((r) => withState(this.db, r)),
    );
    return states.filter((s) => s.composition.length === SET_SIZE).map(toShop);
  }

  /** One set; null for a hidden or unknown key (the shop never confirms a hidden set exists). */
  async discovery(key: string): Promise<DiscoverySet | null> {
    const row = await findDiscoverySet(this.db, key);
    if (!row || row.hidden) return null;
    return toShop(await withState(this.db, row));
  }

  /** The fragrances the builder offers: a visible one with a 10 ml bottle available, best sellers first. */
  async builder(): Promise<Builder> {
    const [row, rank, tenMl] = await Promise.all([
      readDiscoverySet(this.db, MAIN_SET_KEY),
      this.catalog.topSellersOrder(),
      tenMlOf(this.db, { all: true }),
    ]);
    const offered = new Set(tenMl.filter((t) => t.available > 0).map((t) => t.fragranceId));
    // `rank` holds every visible fragrance in top-sellers order
    const ids = rank.filter((id) => offered.has(id));
    return { price: row.price, size: SET_SIZE, options: await this.catalog.listItems(ids) };
  }
}

function toShop({ row, composition, available }: DiscoveryState): DiscoverySet {
  // only sets on sale get here; a hidden one is refused before
  return {
    key: row.key,
    vialMl: asDiscoveryVialMl(row.vialMl),
    name: { ru: row.nameRu, uz: row.nameUz },
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
