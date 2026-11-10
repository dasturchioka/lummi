import type { StockList, StockQuery, StockRow } from '@lummi/contracts';
import { asc, eq, fragrances, sql, volumes, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { available, reservedByVolume } from '../catalog/catalog.service';
import { loadDiscovery } from '../sets/sets';
import { readSettings } from '../settings/settings.service';
import { DB } from '../tokens';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * The stock page's read side (#27): on hand, reserve and available per volume and for the
 * Discovery set. Nothing here decides a number: the Reserve is `reservedByVolume` and the
 * Discovery set's own is `loadDiscovery`, the same code checkout and the shop use. The writes are
 * `CatalogAdminService.setOnHand` and `SetsAdminService.setOnHand`.
 */
@Injectable()
export class StockAdminService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(query: StockQuery): Promise<StockList> {
    const { 'stock.lowAvailableThreshold': lowThreshold } = await readSettings(this.db, [
      'stock.lowAvailableThreshold',
    ]);
    const q = query.q?.trim();
    const volumeRows = await this.db
      .select({
        volumeId: volumes.id,
        name: fragrances.name,
        hidden: fragrances.hidden,
        ml: volumes.ml,
        onHand: volumes.onHand,
      })
      .from(volumes)
      .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
      .where(q ? sql`${fragrances.name} ilike ${'%' + escapeLike(q) + '%'}` : undefined)
      .orderBy(asc(sql`lower(${fragrances.name})`), asc(volumes.ml));
    const reserved = await reservedByVolume(
      this.db,
      volumeRows.map((r) => r.volumeId),
    );
    const rows: StockRow[] = volumeRows.map((r) => {
      const held = reserved.get(r.volumeId) ?? 0;
      return {
        kind: 'volume',
        key: `v${r.volumeId}`,
        volumeId: r.volumeId,
        name: r.name,
        hidden: r.hidden,
        ml: r.ml,
        onHand: r.onHand,
        reserved: held,
        available: available(r.onHand, held),
        belowReserve: r.onHand < held,
      };
    });

    // the Discovery set sorts first: it is the one row that is not a fragrance
    const discovery = await loadDiscovery(this.db);
    if (!q || 'discovery'.includes(q.toLowerCase())) {
      rows.unshift({
        kind: 'discovery',
        key: 'discovery',
        volumeId: null,
        name: null,
        hidden: false,
        ml: null,
        onHand: discovery.row.onHand,
        reserved: discovery.reserved,
        available: discovery.available,
        belowReserve: discovery.row.onHand < discovery.reserved,
      });
    }

    return {
      lowThreshold,
      rows: rows.filter((r) => {
        if (query.filter === 'zero' && r.available !== 0) return false;
        if (query.filter === 'low' && r.available > lowThreshold) return false;
        if (query.visibility === 'hidden' && !r.hidden) return false;
        if (query.visibility === 'visible' && r.hidden) return false;
        return true;
      }),
    };
  }
}
