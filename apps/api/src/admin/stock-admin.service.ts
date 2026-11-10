import type { StockLevel, StockList, StockQuery, StockRow } from '@lummi/contracts';
import { asc, eq, fragrances, sql, volumes, type Db } from '@lummi/db';
import { normalizeUzbek, stripApostrophes } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { available, belowReserve, reservedByVolume } from '../catalog/catalog.service';
import { loadDiscovery } from '../sets/sets';
import { readSettings } from '../settings/settings.service';
import { DB } from '../tokens';
import { containsIgnoringApostrophes } from '../util/apostrophe-match';

/**
 * The stock page's read side (#27): on hand, reserve and available per volume and for the
 * Discovery set. Nothing here decides a number: the Reserve is `reservedByVolume` and the
 * Discovery set's own is `loadDiscovery`, the same code checkout and the shop use. The writes are
 * `CatalogAdminService.setOnHand` and `SetsAdminService.setOnHand`.
 */
/** What the row is called on the page, in both languages (the panel's «Наборы» / «Toʻplamlar»), so a search by any of them finds it. */
const DISCOVERY_LABELS = [
  'Discovery set',
  'Набор Discovery',
  'Наборы',
  'Toʻplam',
  'Discovery toʻplami',
];
const fold = (s: string) => stripApostrophes(normalizeUzbek(s)).toLowerCase();
const matchesDiscoveryLabel = (q: string) =>
  fold(q) !== '' && DISCOVERY_LABELS.some((label) => fold(label).includes(fold(q)));

/** The server decides what is "nothing left" and "running low" (the setting), the client only draws it. */
export const stockLevel = (availableNow: number, lowThreshold: number): StockLevel =>
  availableNow === 0 ? 'zero' : availableNow <= lowThreshold ? 'low' : 'ok';

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
      .where(q ? containsIgnoringApostrophes(fragrances.name, q) : undefined)
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
        belowReserve: belowReserve(r.onHand, held),
        level: stockLevel(available(r.onHand, held), lowThreshold),
      };
    });

    // the Discovery set sorts first: it is the one row that is not a fragrance
    const discovery = await loadDiscovery(this.db);
    if (!q || matchesDiscoveryLabel(q)) {
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
        belowReserve: belowReserve(discovery.row.onHand, discovery.reserved),
        level: stockLevel(discovery.available, lowThreshold),
      });
    }

    return {
      lowThreshold,
      rows: rows.filter((r) => {
        if (query.filter === 'zero' && r.level !== 'zero') return false;
        if (query.filter === 'low' && r.level === 'ok') return false;
        if (query.visibility === 'hidden' && !r.hidden) return false;
        if (query.visibility === 'visible' && r.hidden) return false;
        return true;
      }),
    };
  }
}
