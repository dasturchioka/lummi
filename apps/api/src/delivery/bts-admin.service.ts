import {
  ADMIN_POINTS_PAGE_SIZE,
  type AdminBtsPointDto,
  type AdminPointsQuery,
  type AdminRegionDto,
  type CreateBtsPointBody,
  type UpdateBtsPointBody,
} from '@lummi/contracts';
import {
  and,
  asc,
  btsPoints,
  eq,
  regions,
  sql,
  type BtsPointRow,
  type Db,
  type DbOrTx,
  type RegionRow,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { likeContains, pointSearchText } from '../bts/search-text';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';

export type AdminOutcome<T> =
  { ok: true; value: T } | { ok: false; reason: 'not_found' | 'conflict' | 'unknown_region' };

const FIELDS = ['regionId', 'city', 'name', 'address', 'landmark', 'hours', 'active'] as const;

/** Staff-side BTS points and the owner's tariffs. Every change is audited with the staff member. */
@Injectable()
export class BtsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  private async regionDto(r: RegionRow, tx: DbOrTx = this.db): Promise<AdminRegionDto> {
    const [c] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${btsPoints.active}))::int`,
      })
      .from(btsPoints)
      .where(eq(btsPoints.regionId, r.id));
    return {
      id: r.id,
      code: r.code,
      nameRu: r.nameRu,
      nameUz: r.nameUz,
      deliveryTariff: r.deliveryTariff,
      pointCount: c?.total ?? 0,
      activePointCount: c?.active ?? 0,
    };
  }

  async listRegions(): Promise<AdminRegionDto[]> {
    const rows = await this.db
      .select({
        region: regions,
        total: sql<number>`count(${btsPoints.id})::int`,
        active: sql<number>`(count(${btsPoints.id}) filter (where ${btsPoints.active}))::int`,
      })
      .from(regions)
      .leftJoin(btsPoints, eq(btsPoints.regionId, regions.id))
      .groupBy(regions.id)
      .orderBy(asc(regions.position));
    return rows.map((r) => ({
      id: r.region.id,
      code: r.region.code,
      nameRu: r.region.nameRu,
      nameUz: r.region.nameUz,
      deliveryTariff: r.region.deliveryTariff,
      pointCount: r.total,
      activePointCount: r.active,
    }));
  }

  /** The owner changes a tariff; the old and new values go to the audit log in the same transaction. */
  async setTariff(
    actor: StaffRow,
    regionId: number,
    deliveryTariff: number,
  ): Promise<AdminOutcome<AdminRegionDto>> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(regions)
        .where(eq(regions.id, regionId))
        .for('update');
      if (!before) return { ok: false, reason: 'not_found' } as const;
      if (before.deliveryTariff === deliveryTariff) {
        return { ok: true, value: await this.regionDto(before, tx) } as const;
      }
      const [row] = await tx
        .update(regions)
        .set({ deliveryTariff, updatedAt: this.edges.clock.now() })
        .where(eq(regions.id, regionId))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'region.tariff_changed',
        targetType: 'region',
        targetId: regionId,
        payload: { code: before.code, old: before.deliveryTariff, new: deliveryTariff },
      });
      return { ok: true, value: await this.regionDto(row as RegionRow, tx) } as const;
    });
  }

  private async withRegion(p: BtsPointRow, tx: DbOrTx = this.db): Promise<AdminBtsPointDto> {
    const [r] = await tx.select().from(regions).where(eq(regions.id, p.regionId));
    return {
      id: p.id,
      code: p.code,
      regionId: p.regionId,
      city: p.city,
      name: p.name,
      address: p.address,
      landmark: p.landmark,
      hours: p.hours,
      active: p.active,
      regionNameRu: r?.nameRu ?? '',
      regionNameUz: r?.nameUz ?? '',
    };
  }

  async listPoints(query: AdminPointsQuery) {
    const status = query.status ?? 'all';
    const page = Math.max(1, Number(query.page ?? 1));
    const where = [
      query.regionId !== undefined ? eq(btsPoints.regionId, Number(query.regionId)) : undefined,
      status === 'active' ? eq(btsPoints.active, true) : undefined,
      status === 'hidden' ? eq(btsPoints.active, false) : undefined,
      query.q
        ? sql`(${btsPoints.searchText} like ${likeContains(query.q)} escape '\\' or lower(${btsPoints.code}) = ${query.q.trim().toLowerCase()})`
        : undefined,
    ].filter((w) => w !== undefined);
    const cond = where.length ? and(...where) : undefined;
    const [count] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(btsPoints)
      .where(cond);
    const rows = await this.db
      .select({ point: btsPoints, region: regions })
      .from(btsPoints)
      .innerJoin(regions, eq(regions.id, btsPoints.regionId))
      .where(cond)
      .orderBy(asc(regions.position), asc(btsPoints.city), asc(btsPoints.name), asc(btsPoints.id))
      .limit(ADMIN_POINTS_PAGE_SIZE)
      .offset((page - 1) * ADMIN_POINTS_PAGE_SIZE);
    return {
      items: rows.map(({ point: p, region: r }) => ({
        id: p.id,
        code: p.code,
        regionId: p.regionId,
        city: p.city,
        name: p.name,
        address: p.address,
        landmark: p.landmark,
        hours: p.hours,
        active: p.active,
        regionNameRu: r.nameRu,
        regionNameUz: r.nameUz,
      })),
      total: count?.n ?? 0,
      page,
      pageSize: ADMIN_POINTS_PAGE_SIZE,
    };
  }

  async createPoint(
    actor: StaffRow,
    input: CreateBtsPointBody,
  ): Promise<AdminOutcome<AdminBtsPointDto>> {
    return this.db.transaction(async (tx) => {
      const [region] = await tx
        .select({ id: regions.id })
        .from(regions)
        .where(eq(regions.id, input.regionId));
      if (!region) return { ok: false, reason: 'unknown_region' } as const;
      const values = {
        code: input.code,
        regionId: input.regionId,
        city: input.city,
        name: input.name,
        address: input.address,
        landmark: input.landmark ?? null,
        hours: input.hours ?? null,
        active: input.active ?? true,
      };
      const [row] = await tx
        .insert(btsPoints)
        .values({ ...values, searchText: pointSearchText(values) })
        .onConflictDoNothing({ target: btsPoints.code })
        .returning();
      if (!row) return { ok: false, reason: 'conflict' } as const;
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'bts_point.created',
        targetType: 'bts_point',
        targetId: row.id,
        payload: values,
      });
      return { ok: true, value: await this.withRegion(row, tx) } as const;
    });
  }

  /** Edit fields or hide/show (`active`); the audit entry lists each changed field as from/to. */
  async updatePoint(
    actor: StaffRow,
    id: number,
    input: UpdateBtsPointBody,
  ): Promise<AdminOutcome<AdminBtsPointDto>> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(btsPoints).where(eq(btsPoints.id, id)).for('update');
      if (!before) return { ok: false, reason: 'not_found' } as const;
      if (input.regionId !== undefined) {
        const [region] = await tx
          .select({ id: regions.id })
          .from(regions)
          .where(eq(regions.id, input.regionId));
        if (!region) return { ok: false, reason: 'unknown_region' } as const;
      }
      const next = {
        ...before,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      } as BtsPointRow;
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      for (const f of FIELDS) {
        if (before[f] !== next[f]) changed[f] = { from: before[f], to: next[f] };
      }
      if (Object.keys(changed).length === 0) {
        return { ok: true, value: await this.withRegion(before, tx) } as const;
      }
      const [row] = await tx
        .update(btsPoints)
        .set({
          regionId: next.regionId,
          city: next.city,
          name: next.name,
          address: next.address,
          landmark: next.landmark,
          hours: next.hours,
          active: next.active,
          searchText: pointSearchText(next),
          updatedAt: this.edges.clock.now(),
        })
        .where(eq(btsPoints.id, id))
        .returning();
      const base = {
        actor: { type: 'staff' as const, id: actor.id },
        targetType: 'bts_point',
        targetId: id,
      };
      if (changed['active']) {
        await this.audit.record(tx, {
          ...base,
          action: next.active ? 'bts_point.shown' : 'bts_point.hidden',
          payload: { code: before.code },
        });
      }
      const { active: _active, ...fields } = changed;
      void _active;
      if (Object.keys(fields).length > 0) {
        await this.audit.record(tx, {
          ...base,
          action: 'bts_point.updated',
          payload: { code: before.code, changed: fields },
        });
      }
      return { ok: true, value: await this.withRegion(row as BtsPointRow, tx) } as const;
    });
  }
}
