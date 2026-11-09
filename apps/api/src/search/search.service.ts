import type { SearchResult } from '@lummi/contracts';
import { sql, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { readSettings } from '../settings/settings.service';
import { DB } from '../tokens';
import { skeleton } from './normalize';

interface RankedRow extends Record<string, unknown> {
  id: string | number;
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  /** The top few for the box under the field while typing. */
  async suggest(query: string): Promise<SearchResult> {
    const s = await readSettings(this.db, ['search.suggestLimit']);
    return this.run(query, s['search.suggestLimit']);
  }

  /** The full result list. */
  async search(query: string): Promise<SearchResult> {
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
  async rank(query: string, limit: number): Promise<number[] | 'too-short'> {
    const q = skeleton(query);
    const cfg = await readSettings(this.db, [
      'search.weights',
      'search.minSimilarity',
      'search.minQueryLength',
    ]);
    // The minimum counts the skeleton, not the raw input: `'a` is one letter.
    if (Array.from(q).length < cfg['search.minQueryLength']) return 'too-short';
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

  private async run(query: string, limit: number): Promise<SearchResult> {
    const ids = await this.rank(query, limit);
    if (ids === 'too-short') return { items: [], tooShort: true };
    return { items: await this.catalog.listItems(ids), tooShort: false };
  }
}
