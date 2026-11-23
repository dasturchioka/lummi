import { and, eq, families, fragranceSimilar, fragrances, inArray, volumes } from '@lummi/db';
import type { CatalogQuery } from '@lummi/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import { FILL_UL, setConcentrateUl } from './harness/stock';
import { createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
let settings: SettingsService;
beforeAll(async () => {
  t = await createTestApp();
  settings = new SettingsService(t.db, new AuditService(), t.edges);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await t.seedCatalog();
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
/**
 * Nothing left of the fragrance; with `ml`, just under one fill of it, so that volume is sold out
 * while the smaller ones still fill from the same liquid (ADR 0043).
 */
async function sellOut(slug: string, ml?: 30 | 50) {
  await setConcentrateUl(t, slug, ml ? FILL_UL[ml] - 1 : 0);
}

describe('GET /catalog/fragrances: the list', () => {
  it('needs a session but no registration, and answers 401 without one', async () => {
    const anon = await t.client.catalog.list({ query: {} });
    expect(anon.status).toBe(401);
    expect((await list()).total).toBe(82);
  });

  it('pages the list and counts every match in total', async () => {
    const first = await list({ limit: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.total).toBe(82);
    const second = await list({ limit: 10, offset: 10 });
    const seen = new Set([...first.items, ...second.items].map((i) => i.slug));
    expect(seen.size).toBe(20);
    expect((await list({ limit: 10, offset: 80 })).items).toHaveLength(2);
  });

  it('never lists a hidden fragrance, nor counts it', async () => {
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, 'aventus'));
    const res = await list({ limit: 100 });
    expect(res.items.map((i) => i.slug)).not.toContain('aventus');
    expect(res.total).toBe(81);
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
    expect((await list({ volume: 50 })).total).toBe(81);
  });

  it('filters by price range on the lowest available effective price', async () => {
    await setPrice('aventus', 10, 40_000);
    await setPrice('tygar', 10, 120_000);
    expect(await slugsOf({ priceMax: 50_000 })).toEqual(['aventus']);
    expect(await slugsOf({ priceMin: 100_000 })).toEqual(['tygar']);
    expect((await slugsOf({ priceMin: 40_000, priceMax: 70_000 })).length).toBe(81);
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
    expect(res.facets.families.length).toBe(30);
    expect(res.facets.price).toEqual({ min: 69_000, max: 69_000 });
    await setPrice('tygar', 10, 55_000);
    expect((await list()).facets.price?.min).toBe(55_000);
    // a family whose only fragrances are hidden is not offered
    const [fam] = await t.db.select().from(families).limit(1);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.familyId, fam!.id));
    const after = await list();
    expect(after.facets.families.some((f) => f.id === fam!.id)).toBe(false);
  });
});

describe('query validation', () => {
  it.each([
    'limit=101',
    'limit=0',
    'sort=zzz',
    'priceMin=-1',
    'priceMin=1.5',
    'priceMax=100000001',
    'offset=-1',
    'volume=20',
  ])('answers 400 for %s', async (qs) => {
    const { token } = await t.signIn();
    const res = await fetch(`${t.baseUrl}/catalog/fragrances?${qs}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });
});

describe('one lowest-price rule', () => {
  it('a sold-out cheap volume counts nowhere: card, price filter and price sort agree', async () => {
    // one liquid fills every volume (ADR 0043), so only the biggest bottle can run out alone:
    // the cheap one here is the 50 ml, with too little concentrate left for it
    await setPrice('aventus', 50, 39_000);
    await setPrice('aventus', 10, 99_000);
    await setPrice('aventus', 30, 199_000);
    await sellOut('aventus', 50);
    const asc = await list({ limit: 100, sort: 'price_asc' });
    const card = asc.items.find((i) => i.slug === 'aventus')!;
    expect(card.from).toEqual({ price: 99_000, ml: 10, regularPrice: null });
    expect(card.soldOut).toBe(false);
    // the filter and the sort judge the same number the card shows
    expect(await slugsOf({ priceMax: 50_000 })).not.toContain('aventus');
    expect(await slugsOf({ priceMin: 95_000, priceMax: 100_000 })).toEqual(['aventus']);
    const order = asc.items.flatMap((i) => (i.from ? [i.from.price] : []));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(asc.items.at(-1)?.slug).toBe('aventus');
  });

  it('keeps no «от …» price when nothing is in stock', async () => {
    await sellOut('aventus');
    const card = (await list({ limit: 100 })).items.find((i) => i.slug === 'aventus')!;
    expect(card).toMatchObject({ soldOut: true, from: null });
  });
});

describe('list photo and struck price', () => {
  const card = async (slug: string) =>
    (await list({ limit: 100 })).items.find((i) => i.slug === slug)!;
  const setPhoto = async (slug: string, ml: number, photoHash: string | null) =>
    t.db
      .update(volumes)
      .set({ photoHash })
      .where(and(eq(volumes.fragranceId, await idOf(slug)), eq(volumes.ml, ml)));

  it('shows the 50 ml photo, else the largest volume that has one', async () => {
    expect((await card('tygar')).photo).toBeNull();
    await setPhoto('tygar', 10, 'p10');
    expect((await card('tygar')).photo).toBe('p10');
    await setPhoto('tygar', 30, 'p30');
    expect((await card('tygar')).photo).toBe('p30');
    await setPhoto('tygar', 50, 'p50');
    expect((await card('tygar')).photo).toBe('p50');
  });

  it('on a tie in effective price the marked-down volume is the from-volume', async () => {
    await setPrice('tygar', 10, 60_000);
    await setPrice('tygar', 30, 90_000);
    await t.db
      .update(volumes)
      .set({ salePrice: 60_000, saleEndsAt: new Date('2026-11-12T18:59:59Z') })
      .where(and(eq(volumes.fragranceId, await idOf('tygar')), eq(volumes.ml, 30)));
    t.edges.clock.set(new Date('2026-11-10T10:00:00Z'));
    // 10 ml (60 000, regular) ties the marked-down 30 ml (60 000): the marked-down one is the from-volume
    expect((await card('tygar')).from).toEqual({ price: 60_000, ml: 30, regularPrice: 90_000 });
  });

  it('from.ml is the volume from.price belongs to', async () => {
    const c = await card('tygar');
    const v = c.volumes.find((x) => x.available > 0 && x.effectivePrice === c.from?.price);
    expect(c.from?.ml).toBe(v?.ml);
  });

  it('sets from.regularPrice only while the from-volume is marked down', async () => {
    await setPrice('tygar', 10, 80_000);
    expect((await card('tygar')).from?.regularPrice).toBeNull();
    await t.db
      .update(volumes)
      .set({ salePrice: 60_000, saleEndsAt: new Date('2026-11-12T18:59:59Z') })
      .where(and(eq(volumes.fragranceId, await idOf('tygar')), eq(volumes.ml, 10)));
    t.edges.clock.set(new Date('2026-11-10T10:00:00Z'));
    expect(await card('tygar')).toMatchObject({ from: { price: 60_000, regularPrice: 80_000 } });
    t.edges.clock.set(new Date('2026-11-12T19:00:00Z'));
    expect(await card('tygar')).toMatchObject({ from: { price: 80_000, regularPrice: null } });
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
    expect((await list({ sort: 'price_asc', limit: 1 })).items[0]?.from?.price).toBe(40_000);
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

  /**
   * A controlled subject: symphony with three curated non-peers in a chosen order, its peers
   * (same family and type) with known ages and one pinned hit. Returns what the list must be.
   */
  async function arrange() {
    const all = await t.db.select().from(fragrances);
    all.sort((x, y) => x.id - y.id);
    // age by id: a higher id is newer, so the newest peer is the one with the highest id
    for (const [i, f] of all.entries())
      await t.db
        .update(fragrances)
        .set({ createdAt: new Date(Date.UTC(2026, 9, 1 + i)), isHit: false })
        .where(eq(fragrances.id, f.id));
    // the subject comes from the biggest family-and-type group, so there are peers enough
    const groups = new Map<string, typeof all>();
    for (const f of all) {
      const key = `${f.familyId}/${f.type}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    const biggest = [...groups.values()].sort((x, y) => y.length - x.length)[0]!;
    const me = biggest[0]!;
    const peers = all.filter(
      (f) => f.id !== me.id && f.familyId === me.familyId && f.type === me.type,
    );
    expect(peers.length).toBeGreaterThan(3);
    const hit = peers[0]!; // the oldest peer, pinned: it must lead the fallback
    await t.db.update(fragrances).set({ isHit: true }).where(eq(fragrances.id, hit.id));
    const strangers = all.filter(
      (f) => f.id !== me.id && !(f.familyId === me.familyId && f.type === me.type),
    );
    const curated = [strangers[5]!, strangers[1]!, strangers[3]!]; // the owner's order
    await t.db.delete(fragranceSimilar).where(eq(fragranceSimilar.fragranceId, me.id));
    await t.db
      .insert(fragranceSimilar)
      .values(curated.map((c, position) => ({ fragranceId: me.id, similarId: c.id, position })));
    const fallback = [...peers].sort(
      (x, y) => Number(x.id === hit.id ? 0 : 1) - Number(y.id === hit.id ? 0 : 1) || y.id - x.id,
    );
    return { me, curated, fallback };
  }

  it('lists the curated ones in the owner order, then the same family and type, pinned and newest first, capped at six', async () => {
    const { me, curated, fallback } = await arrange();
    const expected = [...curated, ...fallback].map((f) => f.slug).slice(0, 6);
    expect(expected).toHaveLength(6);
    expect(await slugs(me.slug)).toEqual(expected);
  });

  it('is the same family and type alone when nothing is curated', async () => {
    const { me, fallback } = await arrange();
    await t.db.delete(fragranceSimilar).where(eq(fragranceSimilar.fragranceId, me.id));
    expect(await slugs(me.slug)).toEqual(fallback.map((f) => f.slug).slice(0, 6));
  });

  it('skips a curated or peer fragrance that is sold out or hidden, never lists itself, and honours the count setting', async () => {
    const { me, curated, fallback } = await arrange();
    await sellOut(curated[0]!.slug);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.id, fallback[1]!.id));
    const expected = [curated[1]!, curated[2]!, fallback[0]!, ...fallback.slice(2)]
      .map((f) => f.slug)
      .slice(0, 6);
    expect(await slugs(me.slug)).toEqual(expected);
    expect(expected).not.toContain(me.slug);
    await settings.set('catalog.similarCount', 2, { type: 'system' });
    expect(await slugs(me.slug)).toEqual(expected.slice(0, 2));
  });

  it('answers 404 for an unknown or hidden fragrance', async () => {
    expect((await similar('no-such-scent')).status).toBe(404);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, 'tygar'));
    expect((await similar('tygar')).status).toBe(404);
  });
});
