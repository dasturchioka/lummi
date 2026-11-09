import { and, eq, families, fragranceSimilar, fragrances, inArray, volumes } from '@lummi/db';
import type { CatalogQuery } from '@lummi/contracts';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { seedCatalog } from '../src/catalog/seed';
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

async function list(query: CatalogQuery = {}) {
  const { client } = await t.signIn();
  const res = await client.catalog.list({ query });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return res.body;
}
const slugsOf = async (query: CatalogQuery = {}) =>
  (await list({ limit: 100, ...query })).items.map((i) => i.slug);

const idOf = async (slug: string) =>
  (await t.db.select().from(fragrances).where(eq(fragrances.slug, slug)))[0]!.id;
async function setPrice(slug: string, ml: number, price: number) {
  await t.db
    .update(volumes)
    .set({ price })
    .where(and(eq(volumes.fragranceId, await idOf(slug)), eq(volumes.ml, ml)));
}
async function sellOut(slug: string, ml?: number) {
  const id = await idOf(slug);
  await t.db
    .update(volumes)
    .set({ onHand: 0 })
    .where(ml ? and(eq(volumes.fragranceId, id), eq(volumes.ml, ml)) : eq(volumes.fragranceId, id));
}

describe('GET /catalog/fragrances: the list', () => {
  it('needs a session but no registration, and answers 401 without one', async () => {
    const anon = await t.client.catalog.list({ query: {} });
    expect(anon.status).toBe(401);
    expect((await list()).total).toBe(67);
  });

  it('pages the list and counts every match in total', async () => {
    const first = await list({ limit: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.total).toBe(67);
    const second = await list({ limit: 10, offset: 10 });
    const seen = new Set([...first.items, ...second.items].map((i) => i.slug));
    expect(seen.size).toBe(20);
    expect((await list({ limit: 10, offset: 60 })).items).toHaveLength(7);
  });

  it('never lists a hidden fragrance, nor counts it', async () => {
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, 'aventus'));
    const res = await list({ limit: 100 });
    expect(res.items.map((i) => i.slug)).not.toContain('aventus');
    expect(res.total).toBe(66);
    expect(await slugsOf({ sort: 'new' })).not.toContain('aventus');
    expect(await slugsOf({ sort: 'price_asc' })).not.toContain('aventus');
  });

  it('filters by type, and the total follows', async () => {
    const homme = await list({ type: 'homme', limit: 100 });
    const rows = await t.db.select().from(fragrances).where(eq(fragrances.type, 'homme'));
    expect(homme.total).toBe(rows.length);
    expect(homme.items.every((i) => i.type === 'homme')).toBe(true);
  });

  it('filters by family and by season', async () => {
    const [fam] = await t.db.select().from(families).limit(1);
    const inFam = await t.db.select().from(fragrances).where(eq(fragrances.familyId, fam!.id));
    expect((await slugsOf({ family: fam!.id })).sort()).toEqual(inFam.map((f) => f.slug).sort());
    const autumn = await t.db
      .select()
      .from(fragrances)
      .where(eq(fragrances.season, 'autumn_winter'));
    expect((await list({ season: 'autumn_winter', limit: 100 })).total).toBe(autumn.length);
  });

  it('combines filters with AND', async () => {
    const [fam] = await t.db.select().from(families).limit(1);
    const rows = await t.db.select().from(fragrances).where(eq(fragrances.familyId, fam!.id));
    const type = rows[0]!.type;
    const both = await slugsOf({ family: fam!.id, type });
    expect(both.sort()).toEqual(
      rows
        .filter((r) => r.type === type)
        .map((r) => r.slug)
        .sort(),
    );
  });

  it('keeps only what has the chosen volume in stock', async () => {
    await sellOut('aventus', 50);
    expect(await slugsOf({ volume: 50 })).not.toContain('aventus');
    expect(await slugsOf({ volume: 10 })).toContain('aventus');
    expect((await list({ volume: 50 })).total).toBe(66);
  });

  it('filters by price range on the lowest available effective price', async () => {
    await setPrice('aventus', 10, 40_000);
    await setPrice('tygar', 10, 120_000);
    expect(await slugsOf({ priceMax: 50_000 })).toEqual(['aventus']);
    expect(await slugsOf({ priceMin: 100_000 })).toEqual(['tygar']);
    expect((await slugsOf({ priceMin: 40_000, priceMax: 70_000 })).length).toBe(66);
  });

  it('judges the price range by the chosen volume', async () => {
    await setPrice('aventus', 30, 90_000);
    expect(await slugsOf({ volume: 30, priceMax: 100_000 })).toEqual(['aventus']);
    // its 10 ml is 69 000, so without the volume it is cheap too
    expect(await slugsOf({ priceMax: 69_000 })).toContain('aventus');
  });

  it('returns only the owner-flagged new fragrances with isNew', async () => {
    await t.db
      .update(fragrances)
      .set({ isNew: true })
      .where(inArray(fragrances.slug, ['tygar', 'symphony']));
    expect((await slugsOf({ isNew: '1' })).sort()).toEqual(['symphony', 'tygar']);
  });

  it('answers nothing found as an empty list with total 0', async () => {
    const res = await list({ priceMin: 9_000_000 });
    expect(res).toMatchObject({ items: [], total: 0 });
  });

  it('offers the families present and the price bounds, hidden ones excluded', async () => {
    const res = await list({ type: 'homme', limit: 1 });
    // facets describe the catalog, not the current filter
    expect(res.facets.families.length).toBe(29);
    expect(res.facets.price).toEqual({ min: 69_000, max: 69_000 });
    // the seed in tests has no photos; a chip photo is the top seller's of that type
    expect(res.facets.typePhotos).toEqual({ all: null, homme: null, femme: null, unisex: null });
    const [tygar] = await t.db.select().from(fragrances).where(eq(fragrances.slug, 'tygar'));
    await t.db
      .update(volumes)
      .set({ photoHash: 'abc123' })
      .where(eq(volumes.fragranceId, tygar!.id));
    const photos = (await list()).facets.typePhotos;
    expect(photos.all).toBe('abc123');
    expect(photos[tygar!.type]).toBe('abc123');
    await setPrice('tygar', 10, 55_000);
    expect((await list()).facets.price?.min).toBe(55_000);
    // a family whose only fragrances are hidden is not offered
    const [fam] = await t.db.select().from(families).limit(1);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.familyId, fam!.id));
    const after = await list();
    expect(after.facets.families.some((f) => f.id === fam!.id)).toBe(false);
  });
});

describe('sorting', () => {
  beforeEach(async () => {
    await setPrice('aventus', 10, 50_000);
    await setPrice('tygar', 10, 80_000);
    await setPrice('symphony', 10, 65_000);
  });
  const cheapestThree = async (sort: 'price_asc' | 'price_desc') =>
    (await slugsOf({ sort })).filter((s) => ['aventus', 'tygar', 'symphony'].includes(s));

  it('orders by price ascending and descending', async () => {
    expect(await cheapestThree('price_asc')).toEqual(['aventus', 'symphony', 'tygar']);
    expect(await cheapestThree('price_desc')).toEqual(['tygar', 'symphony', 'aventus']);
    expect((await slugsOf({ sort: 'price_asc' }))[0]).toBe('aventus');
    expect((await slugsOf({ sort: 'price_desc' }))[0]).toBe('tygar');
  });

  it('lets an active markdown change the price order, and the end date revert it', async () => {
    const id = await idOf('tygar');
    await t.db
      .update(volumes)
      .set({ salePrice: 40_000, saleEndsAt: new Date('2026-11-12T18:59:59Z') })
      .where(and(eq(volumes.fragranceId, id), eq(volumes.ml, 10)));
    t.edges.clock.set(new Date('2026-11-10T10:00:00Z'));
    expect((await slugsOf({ sort: 'price_asc' }))[0]).toBe('tygar');
    expect((await list({ sort: 'price_asc', limit: 1 })).items[0]?.fromPrice).toBe(40_000);
    t.edges.clock.set(new Date('2026-11-12T19:00:00Z'));
    expect(await cheapestThree('price_asc')).toEqual(['aventus', 'symphony', 'tygar']);
  });

  it('puts a fragrance with nothing in stock last in both price sorts', async () => {
    await sellOut('aventus');
    expect((await slugsOf({ sort: 'price_asc' })).at(-1)).toBe('aventus');
    expect((await slugsOf({ sort: 'price_desc' })).at(-1)).toBe('aventus');
  });

  it('sorts by new: flagged first, then the newest', async () => {
    await t.db
      .update(fragrances)
      .set({ isNew: true })
      .where(inArray(fragrances.slug, ['tygar', 'symphony']));
    await t.db.update(fragrances).set({ createdAt: new Date('2026-10-01T00:00:00Z') });
    await t.db
      .update(fragrances)
      .set({ createdAt: new Date('2026-11-01T00:00:00Z') })
      .where(eq(fragrances.slug, 'tygar'));
    await t.db
      .update(fragrances)
      .set({ createdAt: new Date('2026-11-05T00:00:00Z') })
      .where(eq(fragrances.slug, 'symphony'));
    await t.db
      .update(fragrances)
      .set({ createdAt: new Date('2026-11-09T00:00:00Z') })
      .where(eq(fragrances.slug, 'aventus'));
    const order = await slugsOf({ sort: 'new' });
    expect(order.slice(0, 3)).toEqual(['symphony', 'tygar', 'aventus']);
  });
});

describe('«Популярное»: topSellersOrder', () => {
  it('is pinned first, then newest (no orders yet)', async () => {
    await t.db.update(fragrances).set({ createdAt: new Date('2026-10-01T00:00:00Z') });
    await t.db
      .update(fragrances)
      .set({ createdAt: new Date('2026-11-01T00:00:00Z') })
      .where(eq(fragrances.slug, 'aventus'));
    await t.db
      .update(fragrances)
      .set({ createdAt: new Date('2026-11-05T00:00:00Z') })
      .where(eq(fragrances.slug, 'tygar'));
    await t.db
      .update(fragrances)
      .set({ isHit: true, createdAt: new Date('2026-09-01T00:00:00Z') })
      .where(eq(fragrances.slug, 'symphony'));
    const order = await slugsOf();
    expect(order.slice(0, 3)).toEqual(['symphony', 'tygar', 'aventus']);
    // the same order drives a chip filter
    const homme = await t.db.select().from(fragrances).where(eq(fragrances.type, 'homme'));
    const filtered = await slugsOf({ type: 'homme' });
    expect(filtered).toEqual(order.filter((s) => homme.some((h) => h.slug === s)));
  });

  it('never ranks a hidden fragrance', async () => {
    await t.db
      .update(fragrances)
      .set({ hidden: true, isHit: true })
      .where(eq(fragrances.slug, 'symphony'));
    expect(await slugsOf()).not.toContain('symphony');
  });
});

describe('the hit and new flags drive the rails', () => {
  const setFlag = (slug: string, flag: { isHit?: boolean; isNew?: boolean }) =>
    t.db.update(fragrances).set(flag).where(eq(fragrances.slug, slug));

  it('moves a fragrance to the front of «Популярное» when it is pinned, and back when unpinned', async () => {
    const before = await slugsOf();
    const last = before.at(-1)!;
    expect(before[0]).not.toBe(last);
    await setFlag(last, { isHit: true });
    expect((await slugsOf())[0]).toBe(last);
    await setFlag(last, { isHit: false });
    expect(await slugsOf()).toEqual(before);
  });

  it('adds a fragrance to «Новинки» when flagged and drops it when unflagged', async () => {
    expect(await slugsOf({ isNew: '1' })).toEqual([]);
    await setFlag('tygar', { isNew: true });
    expect(await slugsOf({ isNew: '1' })).toEqual(['tygar']);
    await setFlag('tygar', { isNew: false });
    expect(await slugsOf({ isNew: '1' })).toEqual([]);
  });
});

describe('«Похожие ароматы»', () => {
  async function similar(slug: string) {
    const { client } = await t.signIn();
    return client.catalog.similar({ params: { slug } });
  }
  const slugs = async (slug: string) => {
    const res = await similar(slug);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return res.body.items.map((i) => i.slug);
  };

  it('puts the curated ones first, in their order, then fills with the same family and type', async () => {
    const id = await idOf('symphony');
    const curated = await t.db
      .select()
      .from(fragranceSimilar)
      .where(eq(fragranceSimilar.fragranceId, id))
      .orderBy(fragranceSimilar.position);
    const curatedSlugs = (
      await Promise.all(
        curated.map((c) => t.db.select().from(fragrances).where(eq(fragrances.id, c.similarId))),
      )
    ).map((r) => r[0]!.slug);
    const got = await slugs('symphony');
    expect(got.length).toBeLessThanOrEqual(6);
    expect(got.slice(0, Math.min(curatedSlugs.length, 6))).toEqual(curatedSlugs.slice(0, 6));
    expect(got).not.toContain('symphony');
    expect(new Set(got).size).toBe(got.length);
  });

  it('falls back to the same family and type when nothing is curated', async () => {
    const [me] = await t.db.select().from(fragrances).where(eq(fragrances.slug, 'symphony'));
    await t.db.delete(fragranceSimilar).where(eq(fragranceSimilar.fragranceId, me!.id));
    const peers = await t.db
      .select()
      .from(fragrances)
      .where(and(eq(fragrances.familyId, me!.familyId!), eq(fragrances.type, me!.type)));
    const got = await slugs('symphony');
    const expected = peers.map((p) => p.slug).filter((s) => s !== 'symphony');
    expect(got.sort()).toEqual(
      expected.slice(0, 6).length === expected.length ? expected.sort() : got.sort(),
    );
    expect(got.every((s) => expected.includes(s))).toBe(true);
    expect(got.length).toBe(Math.min(6, expected.length));
  });

  it('skips what is hidden or sold out, and the count is a setting', async () => {
    const before = await slugs('symphony');
    expect(before.length).toBeGreaterThan(1);
    const [first, second] = before;
    await sellOut(first!);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, second!));
    const after = await slugs('symphony');
    expect(after).not.toContain(first);
    expect(after).not.toContain(second);
    await settings.set('catalog.similarCount', 1, { type: 'system' });
    expect(await slugs('symphony')).toHaveLength(1);
  });

  it('answers 404 for an unknown or hidden fragrance', async () => {
    expect((await similar('no-such-scent')).status).toBe(404);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, 'tygar'));
    expect((await similar('tygar')).status).toBe(404);
  });
});
