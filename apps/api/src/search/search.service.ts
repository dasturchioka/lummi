import type { FragranceListItem } from '@lummi/contracts';
import {
  and,
  asc,
  eq,
  families,
  fragrances,
  inArray,
  sql,
  volumes,
  type Db,
  type VolumeRow,
} from '@lummi/db';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { toVolumeCard, reservedByVolume } from '../catalog/catalog.service';
import type { Edges } from '../edges';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { skeleton } from './normalize';
import { syncSearchIndex } from './search-index';

interface RankedRow extends Record<string, unknown> {
  id: string | number;
}

@Injectable()
export class SearchService implements OnApplicationBootstrap {
  private readonly log = new Logger(SearchService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const n = await syncSearchIndex(this.db);
      if (n > 0) this.log.log(`search index: rebuilt ${n} stale document(s)`);
    } catch (err) {
      this.log.error(`search index sync failed: ${String(err)}`);
    }
  }

  /** The top few for the box under the field while typing. */
  async suggest(query: string): Promise<FragranceListItem[]> {
    const s = await readSettings(this.db, ['search.suggestLimit']);
    return this.run(query, s['search.suggestLimit']);
  }

  /** The full result list. */
  async search(query: string): Promise<FragranceListItem[]> {
    const s = await readSettings(this.db, ['search.resultsLimit']);
    return this.run(query, s['search.resultsLimit']);
  }

  /**
   * Ranking (ADR 0019): an exact name or alias first, then a name or alias word that starts with
   * the query, then a brand, note or family that is the query word for word (so «olcha» puts the
   * fragrances that have that note ahead of a name that merely looks alike), then the weighted
   * trigram score: name and aliases x3, brand x1.5, notes x1,
   * family x1 (the weights are settings). `word_similarity` asks how well the query sits inside
   * the field, so «megamar» finds "megamare" and «ваниль» finds a field full of other notes.
   */
  async rank(query: string, limit: number): Promise<number[]> {
    const q = skeleton(query);
    const cfg = await readSettings(this.db, [
      'search.weights',
      'search.minSimilarity',
      'search.minQueryLength',
    ]);
    if (q === '' || Array.from(query.trim()).length < cfg['search.minQueryLength']) return [];
    const w = cfg['search.weights'];
    const min = cfg['search.minSimilarity'];

    const res = await this.db.execute<RankedRow>(sql`
      with scored as (
        select s.fragrance_id as id, s.name,
          case
            when s.name = ${q}::text or ${q}::text = any(s.aliases) then 3
            when position(' ' || ${q}::text in ' ' || s.name) > 0
              or position(' ' || ${q}::text in ' ' || array_to_string(s.aliases, ' ')) > 0 then 2
            when position(' ' || ${q}::text || ' ' in ' ' || s.brand || ' ') > 0
              or position(' ' || ${q}::text || ' ' in ' ' || s.notes || ' ') > 0
              or position(' ' || ${q}::text || ' ' in ' ' || s.family || ' ') > 0 then 1
            else 0
          end as tier,
          greatest(word_similarity(${q}::text, s.name),
                   word_similarity(${q}::text, array_to_string(s.aliases, ' '))) as n_sim,
          word_similarity(${q}::text, s.brand) as b_sim,
          word_similarity(${q}::text, s.notes) as o_sim,
          word_similarity(${q}::text, s.family) as f_sim
        from fragrance_search s
        join fragrances f on f.id = s.fragrance_id and not f.hidden
      )
      select id from scored
      where tier > 0 or n_sim >= ${min} or b_sim >= ${min} or o_sim >= ${min} or f_sim >= ${min}
      order by tier desc,
        (${w.name}::float8 * n_sim + ${w.brand}::float8 * b_sim
          + ${w.notes}::float8 * o_sim + ${w.family}::float8 * f_sim) desc,
        similarity(${q}::text, name) desc, name
      limit ${limit}
    `);
    return res.rows.map((r) => Number(r.id));
  }

  private async run(query: string, limit: number): Promise<FragranceListItem[]> {
    const ids = await this.rank(query, limit);
    if (ids.length === 0) return [];
    const [rows, vols] = await Promise.all([
      this.db
        .select({
          id: fragrances.id,
          slug: fragrances.slug,
          name: fragrances.name,
          brand: fragrances.originalBrand,
          type: fragrances.type,
          keyNotesRu: fragrances.keyNotesRu,
          keyNotesUz: fragrances.keyNotesUz,
          isHit: fragrances.isHit,
          isNew: fragrances.isNew,
          familyRu: families.nameRu,
          familyUz: families.nameUz,
        })
        .from(fragrances)
        .leftJoin(families, eq(families.id, fragrances.familyId))
        .where(and(inArray(fragrances.id, ids), eq(fragrances.hidden, false))),
      this.db
        .select()
        .from(volumes)
        .where(inArray(volumes.fragranceId, ids))
        .orderBy(asc(volumes.ml)),
    ]);
    const reserved = await reservedByVolume(
      this.db,
      vols.map((v) => v.id),
    );
    const now = this.edges.clock.now();
    const volsOf = new Map<number, VolumeRow[]>();
    for (const v of vols) volsOf.set(v.fragranceId, [...(volsOf.get(v.fragranceId) ?? []), v]);
    const byId = new Map(rows.map((r) => [r.id, r]));

    return ids.flatMap((id) => {
      const f = byId.get(id);
      if (!f) return [];
      const cards = (volsOf.get(id) ?? []).map((v) =>
        toVolumeCard(v, reserved.get(v.id) ?? 0, now),
      );
      return [
        {
          slug: f.slug,
          name: f.name,
          brand: f.brand,
          type: f.type,
          family: f.familyRu && f.familyUz ? { ru: f.familyRu, uz: f.familyUz } : null,
          keyNotes: { ru: f.keyNotesRu, uz: f.keyNotesUz },
          isHit: f.isHit,
          isNew: f.isNew,
          fromPrice: cards.length ? Math.min(...cards.map((c) => c.effectivePrice)) : null,
          soldOut: cards.length === 0 || cards.every((c) => c.available === 0),
          photo: cards[0]?.photo ?? null,
        },
      ];
    });
  }
}
