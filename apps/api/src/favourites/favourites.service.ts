import type { FavouriteIds, FavouriteList } from '@lummi/contracts';
import { DISCOVERY_FAVOURITE } from '@lummi/contracts/constants';
import { and, desc, eq, favourites, fragrances, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { SetsService } from '../sets/sets.service';
import { DB } from '../tokens';

/** The DB's spelling of the set; the route's is `DISCOVERY_FAVOURITE`. */
const SET_KIND = 'discovery_set' as const;

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
    @Inject(SetsService) private readonly sets: SetsService,
  ) {}

  /** The visible favourite fragrances, newest saved first, and whether the set is one (two reads, shared by `ids` and `list`). */
  private async kept(customerId: number) {
    const [fragranceRows, setRows] = await Promise.all([
      this.db
        .select({ id: fragrances.id, slug: fragrances.slug })
        .from(favourites)
        .innerJoin(fragrances, eq(fragrances.id, favourites.fragranceId))
        .where(and(eq(favourites.customerId, customerId), eq(fragrances.hidden, false)))
        .orderBy(desc(favourites.createdAt), desc(favourites.id)),
      this.db
        .select({ id: favourites.id })
        .from(favourites)
        .where(and(eq(favourites.customerId, customerId), eq(favourites.kind, SET_KIND))),
    ]);
    return { fragrances: fragranceRows, discoverySet: setRows.length > 0 };
  }

  /** Slugs (newest saved first) of the visible favourite fragrances, and whether the set is one. */
  async ids(customerId: number): Promise<FavouriteIds> {
    const k = await this.kept(customerId);
    return { slugs: k.fragrances.map((r) => r.slug), discoverySet: k.discoverySet };
  }

  /** `null` for a fragrance that is unknown or hidden. */
  async add(customerId: number, target: string): Promise<FavouriteIds | null> {
    if (target === DISCOVERY_FAVOURITE) {
      await this.db.insert(favourites).values({ customerId, kind: SET_KIND }).onConflictDoNothing();
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
        .where(and(eq(favourites.customerId, customerId), eq(favourites.kind, SET_KIND)));
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
    const k = await this.kept(customerId);
    const items = await this.catalog.listItems(k.fragrances.map((r) => r.id));
    if (!k.discoverySet) return { items, discoverySet: null };
    const { price, available, soldOut, photo } = await this.sets.discovery();
    return { items, discoverySet: { price, available, soldOut, photo } };
  }
}
