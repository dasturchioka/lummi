import { btsPoints, regions, sql, type Db } from '@lummi/db';
import { AuditService } from '../audit/audit.service';
import { pointSearchText } from './search-text';
import { seedRegions } from './seed-regions';
import type { ParsedPoint } from './parse-offices';

export interface SnapshotPoint extends ParsedPoint {
  btsRegionId: number;
}
export interface Snapshot {
  source: string;
  fetchedAt: string;
  points: SnapshotPoint[];
}

export interface ImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * The one-off import, from the committed snapshot of the bts.uz offices page. Idempotent by
 * `code`: a re-run adds only codes that are not there yet and never touches an existing row,
 * so staff edits and hidden points survive. With `refresh` it also rewrites the BTS-published
 * fields (region, city, name, address, landmark, hours) of existing rows; `active` is never touched.
 */
export async function importBtsPoints(
  db: Db,
  snapshot: Snapshot,
  opts: { refresh?: boolean; now?: Date } = {},
): Promise<ImportResult> {
  const audit = new AuditService();
  return db.transaction(async (tx) => {
    await seedRegions(tx);
    const rows = await tx.select({ id: regions.id, btsId: regions.btsId }).from(regions);
    const regionByBts = new Map(rows.map((r) => [r.btsId, r.id]));
    const before = await tx.select({ code: btsPoints.code }).from(btsPoints);
    const known = new Set(before.map((r) => r.code));

    const values = snapshot.points.map((p) => {
      const regionId = regionByBts.get(p.btsRegionId);
      if (regionId === undefined)
        throw new Error(`unknown bts region ${p.btsRegionId} (${p.code})`);
      return {
        code: p.code,
        regionId,
        city: p.city,
        name: p.name,
        address: p.address,
        landmark: p.landmark,
        hours: p.hours,
        searchText: pointSearchText(p),
      };
    });
    const fresh = values.filter((v) => !known.has(v.code));
    const existing = values.filter((v) => known.has(v.code));
    for (let i = 0; i < fresh.length; i += 200) {
      await tx
        .insert(btsPoints)
        .values(fresh.slice(i, i + 200))
        .onConflictDoNothing({ target: btsPoints.code });
    }
    let updated = 0;
    if (opts.refresh) {
      for (const v of existing) {
        const { code, ...set } = v;
        const res = await tx
          .update(btsPoints)
          .set({ ...set, updatedAt: opts.now ?? new Date() })
          .where(
            sql`${btsPoints.code} = ${code} and (${btsPoints.regionId}, ${btsPoints.city}, ${btsPoints.name}, ${btsPoints.address}, ${btsPoints.landmark}, ${btsPoints.hours}) is distinct from (${set.regionId}, ${set.city}, ${set.name}, ${set.address}, ${set.landmark}, ${set.hours})`,
          )
          .returning({ id: btsPoints.id });
        updated += res.length;
      }
    }
    const result = {
      inserted: fresh.length,
      updated,
      unchanged: existing.length - updated,
    };
    if (result.inserted > 0 || result.updated > 0) {
      await audit.record(tx, {
        actor: { type: 'system' },
        action: 'bts_points.imported',
        targetType: 'bts_points',
        payload: {
          source: snapshot.source,
          fetchedAt: snapshot.fetchedAt,
          refresh: !!opts.refresh,
          ...result,
        },
      });
    }
    return result;
  });
}
