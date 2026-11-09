import type { BtsPointDto, CityDto, DeliveryCityDto, RegionDto } from '@lummi/contracts';
import { POINT_SEARCH_LIMIT } from '@lummi/contracts';
import {
  and,
  asc,
  btsPoints,
  customers,
  eq,
  regions,
  sql,
  type BtsPointRow,
  type Db,
  type RegionRow,
} from '@lummi/db';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { likeContains } from '../bts/search-text';
import { seedRegions } from '../bts/seed-regions';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';

export const toRegionDto = (r: RegionRow): RegionDto => ({
  id: r.id,
  nameRu: r.nameRu,
  nameUz: r.nameUz,
  deliveryTariff: r.deliveryTariff,
});

export const toPointDto = (p: BtsPointRow): BtsPointDto => ({
  id: p.id,
  code: p.code,
  regionId: p.regionId,
  city: p.city,
  name: p.name,
  address: p.address,
  landmark: p.landmark,
  hours: p.hours,
});

export type SetCityOutcome =
  | { ok: true; deliveryCity: DeliveryCityDto }
  | { ok: false; reason: 'customer_not_found' | 'region_not_found' | 'unknown_city' };

/** Customer-facing delivery data: regions with tariffs, offered cities and points, the Home delivery city. */
@Injectable()
export class DeliveryService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  /** The 14 regions are reference data: make sure they exist, never reset a tariff. */
  async onApplicationBootstrap(): Promise<void> {
    await seedRegions(this.db);
  }

  async regions(): Promise<RegionDto[]> {
    const rows = await this.db.select().from(regions).orderBy(asc(regions.position));
    return rows.map(toRegionDto);
  }

  /** The tariff the quote takes as input for a region; null for an unknown region. */
  async tariffFor(regionId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ t: regions.deliveryTariff })
      .from(regions)
      .where(eq(regions.id, regionId));
    return row?.t ?? null;
  }

  /** Cities and districts with at least one offered point; null when the region does not exist. */
  async cities(regionId: number): Promise<CityDto[] | null> {
    const [region] = await this.db
      .select({ id: regions.id })
      .from(regions)
      .where(eq(regions.id, regionId));
    if (!region) return null;
    const rows = await this.db
      .select({ city: btsPoints.city, pointCount: sql<number>`count(*)::int` })
      .from(btsPoints)
      .where(and(eq(btsPoints.regionId, regionId), eq(btsPoints.active, true)))
      .groupBy(btsPoints.city)
      .orderBy(asc(btsPoints.city));
    return rows;
  }

  /** Offered (active) points of a city, and/or a text search across everything; hidden ones never come back. */
  async points(q: { regionId?: number; city?: string; q?: string }): Promise<BtsPointDto[]> {
    const where = [eq(btsPoints.active, true)];
    if (q.regionId !== undefined && q.city !== undefined) {
      where.push(eq(btsPoints.regionId, q.regionId), eq(btsPoints.city, q.city));
    }
    if (q.q !== undefined)
      where.push(sql`${btsPoints.searchText} like ${likeContains(q.q)} escape '\\'`);
    const rows = await this.db
      .select()
      .from(btsPoints)
      .where(and(...where))
      .orderBy(asc(btsPoints.city), asc(btsPoints.name), asc(btsPoints.id))
      .limit(q.q !== undefined ? POINT_SEARCH_LIMIT : 500);
    return rows.map(toPointDto);
  }

  async getDeliveryCity(customerId: number): Promise<DeliveryCityDto | null> {
    const [row] = await this.db
      .select({ region: regions, city: customers.deliveryCity })
      .from(customers)
      .innerJoin(regions, eq(regions.id, customers.deliveryRegionId))
      .where(eq(customers.id, customerId));
    return row?.city ? { region: toRegionDto(row.region), city: row.city } : null;
  }

  /** Region + city must come from the offered list, so the saved city always has points to pick from. */
  async setDeliveryCity(
    customerId: number,
    regionId: number,
    city: string,
  ): Promise<SetCityOutcome> {
    return this.db.transaction(async (tx) => {
      const [region] = await tx.select().from(regions).where(eq(regions.id, regionId));
      if (!region) return { ok: false, reason: 'region_not_found' } as const;
      const [offered] = await tx
        .select({ id: btsPoints.id })
        .from(btsPoints)
        .where(
          and(
            eq(btsPoints.regionId, regionId),
            eq(btsPoints.city, city),
            eq(btsPoints.active, true),
          ),
        )
        .limit(1);
      if (!offered) return { ok: false, reason: 'unknown_city' } as const;
      const [before] = await tx
        .select({ regionId: customers.deliveryRegionId, city: customers.deliveryCity })
        .from(customers)
        .where(eq(customers.id, customerId));
      if (!before) return { ok: false, reason: 'customer_not_found' } as const;
      if (before.regionId !== regionId || before.city !== city) {
        await tx
          .update(customers)
          .set({
            deliveryRegionId: regionId,
            deliveryCity: city,
            updatedAt: this.edges.clock.now(),
          })
          .where(eq(customers.id, customerId));
        await this.audit.record(tx, {
          actor: { type: 'customer', id: customerId },
          action: 'customer.delivery_city_changed',
          targetType: 'customer',
          targetId: customerId,
          payload: { from: before, to: { regionId, city } },
        });
      }
      return { ok: true, deliveryCity: { region: toRegionDto(region), city } } as const;
    });
  }

  async clearDeliveryCity(customerId: number): Promise<void> {
    await this.db
      .update(customers)
      .set({ deliveryRegionId: null, deliveryCity: null, updatedAt: this.edges.clock.now() })
      .where(eq(customers.id, customerId));
  }
}
