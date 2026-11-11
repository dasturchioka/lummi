import { DISCOVERY_FAVOURITE, type FavouriteIds, type FavouriteList } from '@lummi/contracts';
import { and, desc, eq, favourites, fragrances, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { loadDiscovery } from '../sets/sets';
import { DB } from '../tokens';

/**
 * Favourites (#45): a heart per customer and target, a fragrance or the Discovery set. Add and
 * remove are idempotent. A hidden fragrance is neither addable nor listed, but its row stays, so it
 * returns to the list when the owner shows it again.
 */
@Injectable()
export class FavouritesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  /** Slugs (newest saved first) of the visible favourite fragrances, and whether the set is one. */
  async ids(customerId: number): Promise<FavouriteIds> {
    const [fragranceRows, setRows] = await Promise.all([
      this.db
        .select({ slug: fragrances.slug })
        .from(favourites)
        .innerJoin(fragrances, eq(fragrances.id, favourites.fragranceId))
        .where(and(eq(favourites.customerId, customerId), eq(fragrances.hidden, false)))
        .orderBy(desc(favourites.createdAt), desc(favourites.id)),
      this.db
        .select({ id: favourites.id })
        .from(favourites)
        .where(and(eq(favourites.customerId, customerId), eq(favourites.kind, 'discovery_set'))),
    ]);
    return { slugs: fragranceRows.map((r) => r.slug), discoverySet: setRows.length > 0 };
  }

  /** `null` for a fragrance that is unknown or hidden. */
  async add(customerId: number, target: string): Promise<FavouriteIds | null> {
    if (target === DISCOVERY_FAVOURITE) {
      await this.db
        .insert(favourites)
        .values({ customerId, kind: 'discovery_set' })
        .onConflictDoNothing();
    } else {
      const [f] = await this.db
        .select({ id: fragrances.id })
        .from(fragrances)
        .where(and(eq(fragrances.slug, target), eq(fragrances.hidden, false)));
      if (!f) return null;
      await this.db
        .insert(favourites)
        .values({ customerId, fragranceId: f.id })
        .onConflictDoNothing();
    }
    return this.ids(customerId);
  }

  async remove(customerId: number, target: string): Promise<FavouriteIds> {
    if (target === DISCOVERY_FAVOURITE) {
      await this.db
        .delete(favourites)
        .where(and(eq(favourites.customerId, customerId), eq(favourites.kind, 'discovery_set')));
    } else {
      const [f] = await this.db
        .select({ id: fragrances.id })
        .from(fragrances)
        .where(eq(fragrances.slug, target));
      if (f)
        await this.db
          .delete(favourites)
          .where(and(eq(favourites.customerId, customerId), eq(favourites.fragranceId, f.id)));
    }
    return this.ids(customerId);
  }

  async list(customerId: number): Promise<FavouriteList> {
    const rows = await this.db
      .select({ id: fragrances.id })
      .from(favourites)
      .innerJoin(fragrances, eq(fragrances.id, favourites.fragranceId))
      .where(and(eq(favourites.customerId, customerId), eq(fragrances.hidden, false)))
      .orderBy(desc(favourites.createdAt), desc(favourites.id));
    const items = await this.catalog.listItems(rows.map((r) => r.id));
    const [set] = await this.db
      .select({ id: favourites.id })
      .from(favourites)
      .where(and(eq(favourites.customerId, customerId), eq(favourites.kind, 'discovery_set')));
    if (!set) return { items, discoverySet: null };
    const { row, available } = await loadDiscovery(this.db);
    return {
      items,
      discoverySet: {
        price: row.price,
        available,
        soldOut: available === 0,
        photo: row.photoHash,
      },
    };
  }
}
