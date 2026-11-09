import { fragranceNotes, fragrances, notes, eq, inArray } from '@lummi/db';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCatalog } from '../src/catalog/seed';
import { CONTROL_QUERIES, type ControlQuery } from './search-control-queries';
import { createTestApp, type TestApp } from './harness/test-app';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
/** TZ §3.2: the expected fragrance in the top 3 for at least 27 of the 30 control queries. */
const REQUIRED = 27;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
});
afterAll(() => t.close());

async function top3(q: string): Promise<string[]> {
  const { client } = await t.signIn();
  const res = await client.catalog.search({ query: { q } });
  if (res.status !== 200) throw new Error(`search ${q}: HTTP ${res.status}`);
  return res.body.items.slice(0, 3).map((i) => i.slug);
}

async function slugsWithNotes(ruNames: string[]): Promise<Set<string>> {
  const rows = await t.db
    .select({ slug: fragrances.slug })
    .from(fragranceNotes)
    .innerJoin(notes, eq(notes.id, fragranceNotes.noteId))
    .innerJoin(fragrances, eq(fragrances.id, fragranceNotes.fragranceId))
    .where(inArray(notes.nameRu, ruNames));
  return new Set(rows.map((r) => r.slug));
}

async function slugsOfBrand(brand: string): Promise<Set<string>> {
  const rows = await t.db
    .select({ slug: fragrances.slug })
    .from(fragrances)
    .where(eq(fragrances.originalBrand, brand));
  return new Set(rows.map((r) => r.slug));
}

async function passes(c: ControlQuery, got: string[]): Promise<boolean> {
  if (got.length === 0) return false;
  if (c.kind === 'name') return got.some((s) => c.slugs.includes(s));
  const pool = c.kind === 'note' ? await slugsWithNotes(c.notes) : await slugsOfBrand(c.brand);
  // Only so many fragrances can answer: the first slots must all be answers.
  return got.slice(0, Math.min(3, pool.size)).every((s) => pool.has(s));
}

describe('search control queries (CI gate)', () => {
  it('has exactly 30 queries', () => {
    expect(CONTROL_QUERIES).toHaveLength(30);
  });

  it(`finds the expected fragrance in the top 3 for at least ${REQUIRED} of 30`, async () => {
    const failed: string[] = [];
    let ok = 0;
    for (const c of CONTROL_QUERIES) {
      const got = await top3(c.q);
      const pass = await passes(c, got);
      if (process.env.SEARCH_VERBOSE)
        console.log(pass ? 'ok  ' : 'FAIL', `«${c.q}»`, got.join(', '));
      if (pass) ok += 1;
      else failed.push(`«${c.q}» (${c.why}) -> ${got.join(', ') || 'nothing'}`);
    }
    console.log(`search control queries: ${ok}/30`);
    expect(ok, `failed:\n${failed.join('\n')}`).toBeGreaterThanOrEqual(REQUIRED);
  });
});
