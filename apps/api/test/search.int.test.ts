import { eq, fragrances, volumes } from '@lummi/db';
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
const slugs = async (q: string, route: 'search' | 'suggest' = 'search') =>
  (await search(q, route)).map((i) => i.slug);

describe('suggest', () => {
  it('starts at two characters and returns the top 5', async () => {
    expect(await slugs('a', 'suggest')).toEqual([]);
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

  it('shows the price to start from and a sold-out fragrance as such', async () => {
    const [row] = await t.db.select().from(fragrances).where(eq(fragrances.slug, 'aventus'));
    await t.db.update(volumes).set({ onHand: 0 }).where(eq(volumes.fragranceId, row!.id));
    const [hit] = await search('aventus');
    expect(hit).toMatchObject({ soldOut: true, fromPrice: 69_000 });
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

describe('search document stays current', () => {
  it('a new alias is found once the fragrance is reindexed', async () => {
    expect(await slugs('аванти')).not.toContain('aventus');
    const [row] = await t.db.select().from(fragrances).where(eq(fragrances.slug, 'aventus'));
    await t.db.transaction(async (tx) => {
      await tx
        .update(fragrances)
        .set({ aliases: ['Аванти'] })
        .where(eq(fragrances.id, row!.id));
      await reindexFragrances(tx, [row!.id]);
    });
    expect((await slugs('аванти'))[0]).toBe('aventus');
  });

  it('syncSearchIndex heals a document that lags its fragrance, and fills a missing one', async () => {
    const [row] = await t.db.select().from(fragrances).where(eq(fragrances.slug, 'tilia'));
    await t.db
      .update(fragrances)
      .set({ name: 'Linden', updatedAt: new Date(Date.now() + 5000) })
      .where(eq(fragrances.id, row!.id));
    expect(await slugs('linden')).not.toContain('tilia');
    expect(await syncSearchIndex(t.db)).toBe(1);
    expect((await slugs('linden'))[0]).toBe('tilia');
    expect(await syncSearchIndex(t.db)).toBe(0);
  });
});
