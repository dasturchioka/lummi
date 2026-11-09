import { eq, families, fragranceSearch, fragrances, notes, sql, volumes } from '@lummi/db';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { seedCatalog } from '../src/catalog/seed';
import { reindexFragrances, syncSearchIndex } from '../src/search/search-index';
import { SettingsService } from '../src/settings/settings.service';
import { createTestApp, type TestApp } from './harness/test-app';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));

let t: TestApp;
let settings: SettingsService;
beforeAll(async () => {
  t = await createTestApp();
  settings = new SettingsService(t.db, new AuditService(), t.edges);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
});

async function search(q: string, route: 'search' | 'suggest' = 'search') {
  const { client } = await t.signIn();
  const res = await client.catalog[route]({ query: { q } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return res.body.items;
}
async function tooShort(q: string) {
  const { client } = await t.signIn();
  const res = await client.catalog.suggest({ query: { q } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return res.body.tooShort;
}
const slugs = async (q: string, route: 'search' | 'suggest' = 'search') =>
  (await search(q, route)).map((i) => i.slug);

describe('suggest', () => {
  it('starts at two characters and returns the top 5', async () => {
    expect(await slugs('a', 'suggest')).toEqual([]);
    expect(await tooShort("'a")).toBe(true); // the apostrophe does not count: one letter
    expect(await tooShort('av')).toBe(false);
    expect(await tooShort('qwxzvk')).toBe(false); // long enough, simply nothing found
    expect(await slugs(' a ', 'suggest')).toEqual([]);
    expect((await slugs('av', 'suggest'))[0]).toBe('aventus');
    expect((await slugs('lo', 'suggest')).length).toBeLessThanOrEqual(5);
    expect((await slugs('lo', 'suggest')).length).toBe(5);
  });

  it('the length of suggestions and the minimum are settings', async () => {
    await settings.set('search.suggestLimit', 2, { type: 'system' });
    expect(await slugs('lo', 'suggest')).toHaveLength(2);
    await settings.set('search.minQueryLength', 3, { type: 'system' });
    expect(await slugs('av', 'suggest')).toEqual([]);
    expect((await slugs('ave', 'suggest'))[0]).toBe('aventus');
  });
});

describe('search', () => {
  it('needs a session', async () => {
    const res = await t.client.catalog.search({ query: { q: 'aventus' } });
    expect(res.status).toBe(401);
  });

  it('an exact name beats a longer name that contains it, and a name beats a note', async () => {
    expect((await slugs('aventus'))[0]).toBe('aventus');
    expect((await slugs('oud')).slice(0, 2).sort()).toEqual(['oud-maracuja', 'oud-wood']);
  });

  it('finds the same fragrance in either alphabet and with either apostrophe', async () => {
    for (const q of ["Angels' Share", 'Angels’ Share', 'angels share', 'ангелс шер'])
      expect((await slugs(q))[0], q).toBe('angels-share');
    for (const q of ["Bal d'Afrique", 'bal dʻafrique', 'Bal Dafrique'])
      expect((await slugs(q))[0], q).toBe('bal-dafrique');
    expect((await slugs('meteore'))[0]).toBe('meteore');
    expect((await slugs('Météore'))[0]).toBe('meteore');
  });

  it('says nothing for gibberish', async () => {
    expect(await slugs('qwxzvk')).toEqual([]);
    expect(await slugs('????')).toEqual([]);
  });

  it('never lists a hidden fragrance and carries only customer-safe fields', async () => {
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, 'aventus'));
    expect(await slugs('aventus')).not.toContain('aventus');
    await t.db.update(fragrances).set({ hidden: false }).where(eq(fragrances.slug, 'aventus'));
    const [hit] = await search('aventus');
    expect(hit).toEqual({
      slug: 'aventus',
      name: 'Aventus',
      brand: 'Creed',
      type: 'homme',
      family: { ru: 'Фруктовый шипровый', uz: expect.any(String) },
      keyNotes: { ru: ['ананас', 'берёза', 'мускус'], uz: expect.any(Array) },
      isHit: false,
      isNew: false,
      fromPrice: 69_000,
      soldOut: false,
      photo: null,
    });
  });

  it('shows the price to start from (in-stock volumes only) and a sold-out fragrance without one', async () => {
    const [aventus] = await search('aventus');
    expect(aventus).toMatchObject({ soldOut: false, fromPrice: 69_000 });
    const [row] = await t.db.select().from(fragrances).where(eq(fragrances.slug, 'aventus'));
    await t.db.update(volumes).set({ onHand: 0 }).where(eq(volumes.fragranceId, row!.id));
    const [hit] = await search('aventus');
    expect(hit).toMatchObject({ soldOut: true, fromPrice: null });
  });

  it('the result limit, the similarity floor and the weights are settings', async () => {
    await settings.set('search.resultsLimit', 3, { type: 'system' });
    expect(await slugs('lo')).toHaveLength(3);
    await settings.set('search.minSimilarity', 1, { type: 'system' });
    expect(await slugs('symphny')).toEqual([]);
    expect((await slugs('symphony'))[0]).toBe('symphony');
    await settings.set('search.minSimilarity', 0.3, { type: 'system' });
    expect(await slugs('symphny')).toContain('symphony');
  });
});

describe('a note on the card outranks a note deeper down', () => {
  it.each([
    ['zanjabil', 'uz', 'zanjabil'],
    ['имбирь', 'ru', 'имбирь'],
    ['bergamot', 'uz', 'bergamot'],
  ] as const)(
    '«%s»: the first results carry it among the three key notes',
    async (q, lang, note) => {
      const items = await search(q);
      // Every fragrance that has the note on its card comes before any that has it deeper only.
      const onCard = items.map((i) => i.keyNotes[lang].some((n) => n.toLowerCase() === note));
      expect(onCard[0], q).toBe(true);
      const firstOff = onCard.indexOf(false);
      if (firstOff !== -1) expect(onCard.slice(firstOff), q).not.toContain(true);
    },
  );
});

describe('search document stays current', () => {
  async function docOf(slug: string) {
    const [r] = await t.db
      .select({ doc: fragranceSearch })
      .from(fragranceSearch)
      .innerJoin(fragrances, eq(fragrances.id, fragranceSearch.fragranceId))
      .where(eq(fragrances.slug, slug));
    return r!.doc;
  }
  const idOf = async (slug: string) =>
    (await t.db.select().from(fragrances).where(eq(fragrances.slug, slug)))[0]!.id;

  it('a new alias is found once the fragrance is reindexed in the same transaction', async () => {
    expect(await slugs('аванти')).not.toContain('aventus');
    const id = await idOf('aventus');
    await t.db.transaction(async (tx) => {
      await tx
        .update(fragrances)
        .set({ aliases: ['Аванти'] })
        .where(eq(fragrances.id, id));
      expect(await reindexFragrances(tx, [id])).toBe(1);
    });
    expect((await slugs('аванти'))[0]).toBe('aventus');
  });

  it('writes only documents whose text changed', async () => {
    const id = await idOf('aventus');
    expect(await t.db.transaction((tx) => reindexFragrances(tx, [id]))).toBe(0);
    expect(await t.db.transaction((tx) => reindexFragrances(tx, []))).toBe(0);
  });

  it('syncSearchIndex heals a renamed note and a renamed family, which no timestamp shows', async () => {
    await t.db.update(notes).set({ nameRu: 'зелёный перец' }).where(eq(notes.nameRu, 'шафран'));
    await t.db
      .update(families)
      .set({ nameRu: 'Агрумовый' })
      .where(eq(families.nameRu, 'Фруктовый шипровый'));
    expect(await slugs('зелёный перец')).not.toContain('safran-secret');
    expect(await syncSearchIndex(t.db)).toBeGreaterThan(0);
    expect(await slugs('зелёный перец')).toContain('safran-secret');
    expect((await docOf('aventus')).family).toContain('agrumovi');
    expect(await syncSearchIndex(t.db)).toBe(0);
  });

  it('syncSearchIndex fills a missing document', async () => {
    const id = await idOf('tilia');
    await t.db.delete(fragranceSearch).where(eq(fragranceSearch.fragranceId, id));
    expect(await slugs('tilia')).not.toContain('tilia');
    expect(await syncSearchIndex(t.db)).toBe(1);
    expect((await slugs('tilia'))[0]).toBe('tilia');
  });

  it('an upsert cannot replace a document stamped later than the build', async () => {
    const id = await idOf('tilia');
    const later = new Date(Date.now() + 3_600_000);
    await t.db
      .update(fragranceSearch)
      .set({ name: 'newer', updatedAt: later })
      .where(eq(fragranceSearch.fragranceId, id));
    await t.db.transaction((tx) => reindexFragrances(tx, [id]));
    expect((await docOf('tilia')).name).toBe('newer');
  });

  it('two syncs at once leave one consistent index', async () => {
    await t.db.delete(fragranceSearch);
    await Promise.all([syncSearchIndex(t.db), syncSearchIndex(t.db)]);
    const n = (await t.db.execute<{ n: string }>(sql`select count(*) as n from fragrance_search`))
      .rows[0]!.n;
    expect(Number(n)).toBe(67);
  });
});
