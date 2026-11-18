import { families, fragrances, volumes, eq, and } from '@lummi/db';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { beforeEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCatalog } from '../src/catalog/seed';
import { createTestApp, type TestApp } from './harness/test-app';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await t.seedCatalog();
});

async function card(slug: string) {
  const { client } = await t.signIn();
  return client.catalog.fragrance({ params: { slug } });
}

describe('seed', () => {
  it('loads all 67 fragrances, 29 families and three flagged placeholder volumes each', async () => {
    expect(await t.db.select().from(fragrances)).toHaveLength(67);
    expect(await t.db.select().from(families)).toHaveLength(29);
    const vols = await t.db.select().from(volumes);
    expect(vols).toHaveLength(67 * 3);
    expect(vols.every((v) => v.isPlaceholder && v.onHand === 20)).toBe(true);
    expect(vols.filter((v) => v.ml === 30).every((v) => v.price === 149_000)).toBe(true);
  });

  it('shows «до 24 часов» / «24 soatgacha» for every fragrance, not the guide hours', async () => {
    const rows = await t.db.select().from(fragrances);
    expect(new Set(rows.map((r) => r.longevityRu))).toEqual(new Set(['до 24 часов']));
    expect(new Set(rows.map((r) => r.longevityUz))).toEqual(new Set(['24 soatgacha']));
  });

  it('is idempotent and keeps prices someone has since changed', async () => {
    await t.db.update(volumes).set({ price: 123_000 }).where(eq(volumes.ml, 10));
    // the real seed again: this is what is tested, not the harness's copy
    await seedCatalog(t.db, { materialsDir });
    expect(await t.db.select().from(fragrances)).toHaveLength(67);
    const [v] = await t.db.select().from(volumes).where(eq(volumes.ml, 10)).limit(1);
    expect(v?.price).toBe(123_000);
  });
});

describe('GET /catalog/fragrances/:slug', () => {
  it('returns the card in both languages with notes by level and three volumes', async () => {
    const res = await card('symphony');
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const c = res.body;
    expect(c).toMatchObject({
      slug: 'symphony',
      name: 'Symphony',
      brand: 'Louis Vuitton',
      longevity: { ru: 'до 24 часов', uz: '24 soatgacha' },
    });
    expect(c.keyNotes.ru).toHaveLength(3);
    expect(c.keyNotes.uz).toHaveLength(3);
    expect(c.description.ru.length).toBeGreaterThan(10);
    expect(c.description.uz.length).toBeGreaterThan(10);
    expect(c.notes.top.length + c.notes.heart.length + c.notes.base.length).toBeGreaterThan(3);
    expect(c.family?.ru).toBeTruthy();
    expect(c.volumes.map((v) => v.ml)).toEqual([10, 30, 50]);
    expect(c.volumes.map((v) => v.price)).toEqual([69_000, 149_000, 219_000]);
    expect(c.volumes.every((v) => v.salePrice === null && v.available === 20)).toBe(true);
  });

  it('offers the step-ups the settings allow (#57)', async () => {
    const stepsOf = async (slug: string) => {
      const res = await card(slug);
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
      return res.body.stepUps;
    };
    expect(await stepsOf('symphony')).toEqual([
      { fromMl: 10, toMl: 30, saving: 58_000 },
      { fromMl: 30, toMl: 50, saving: 29_000 },
    ]);
    const owner = await t.ownerSession();
    const set = async (key: string, value: unknown) => {
      const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
      expect(res.status).toBe(200);
    };
    // 10 → 30 saves 28 %, 30 → 50 11 %
    await set('catalog.stepUp.minPercent', 20);
    expect(await stepsOf('symphony')).toEqual([{ fromMl: 10, toMl: 30, saving: 58_000 }]);
    // a sold-out 30 ml: the 10 ml steps over it
    const [sym] = await t.db.select().from(fragrances).where(eq(fragrances.slug, 'symphony'));
    await t.db
      .update(volumes)
      .set({ onHand: 0 })
      .where(and(eq(volumes.fragranceId, sym!.id), eq(volumes.ml, 30)));
    expect(await stepsOf('symphony')).toEqual([{ fromMl: 10, toMl: 50, saving: 126_000 }]);
    await set('catalog.stepUp.enabled', false);
    expect(await stepsOf('symphony')).toEqual([]);
  });

  it('carries the stock-count setting (#70), default on', async () => {
    const flag = async () => {
      const res = await card('symphony');
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
      return res.body.showStockCount;
    };
    expect(await flag()).toBe(true);
    const owner = await t.ownerSession();
    const res = await owner.client.admin.settings.update({
      params: { key: 'catalog.showStockCount' },
      body: { value: false },
    });
    expect(res.status).toBe(200);
    expect(await flag()).toBe(false);
  });

  it('answers 404 for an unknown slug and for a hidden fragrance, 401 without a session', async () => {
    expect((await card('no-such-scent')).status).toBe(404);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, 'tygar'));
    expect((await card('tygar')).status).toBe(404);
    const anon = await t.client.catalog.fragrance({ params: { slug: 'tygar' } });
    expect(anon.status).toBe(401);
  });

  it('never exposes the internal remark or the internal code', async () => {
    const [remarked] = await t.db
      .select()
      .from(fragrances)
      .where(eq(fragrances.slug, 'safran-secret'));
    expect(remarked?.internalRemark).toContain('Fragrantica');
    const { token } = await t.signIn();
    const res = await fetch(`${t.baseUrl}/catalog/fragrances/safran-secret`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('Fragrantica');
    expect(text).not.toContain(remarked?.code ?? 'x');
    expect(Object.keys(JSON.parse(text))).not.toContain('internalRemark');
    expect(Object.keys(JSON.parse(text))).not.toContain('code');
  });

  describe('markdown (ADR 0008)', () => {
    const setSale = async (salePrice: number, saleEndsAt: Date | null) => {
      const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, 'tygar'));
      await t.db
        .update(volumes)
        .set({ salePrice, saleEndsAt })
        .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, 30)));
    };
    const vol30 = async () => {
      const res = await card('tygar');
      if (res.status !== 200) throw new Error('card');
      return res.body.volumes.find((v) => v.ml === 30)!;
    };

    it('is the effective price with a percent badge and end date while active', async () => {
      await setSale(119_200, new Date('2026-11-12T18:59:59Z'));
      expect(await vol30()).toMatchObject({
        price: 149_000,
        salePrice: 119_200,
        effectivePrice: 119_200,
        salePercent: 20,
        saleEndsAt: '2026-11-12T18:59:59.000Z',
      });
    });

    it('reverts by itself once the end date has passed, with no job', async () => {
      await setSale(119_200, new Date('2026-11-12T18:59:59Z'));
      t.edges.clock.set(new Date('2026-11-12T19:00:00Z'));
      expect(await vol30()).toMatchObject({
        salePrice: null,
        salePercent: null,
        saleEndsAt: null,
        effectivePrice: 149_000,
      });
    });

    it('ignores a sale price that is not below the regular one', async () => {
      await setSale(149_000, null);
      expect((await vol30()).salePrice).toBeNull();
    });
  });

  it('marks a sold-out volume with zero available', async () => {
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, 'tygar'));
    await t.db
      .update(volumes)
      .set({ onHand: 0 })
      .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, 50)));
    const res = await card('tygar');
    expect(res.status === 200 && res.body.volumes.find((v) => v.ml === 50)?.available).toBe(0);
  });
});

describe('photos through FileStore', () => {
  it('renders 3:4 WebP at 400/800/1200 under content-hash names, keeps the source, serves immutable', async () => {
    await seedCatalog(t.db, { materialsDir, photos: t.edges.files, limit: 1 });
    const res = await card('guidance');
    if (res.status !== 200) throw new Error('card');
    const hashes = res.body.volumes.map((v) => v.photo);
    expect(hashes.every((h) => /^[a-f0-9]{16}$/.test(h ?? ''))).toBe(true);
    expect(new Set(hashes).size).toBe(3);

    const hash = hashes[0]!;
    for (const w of [400, 800, 1200]) {
      const bytes = t.edges.files.files.get(`public/${hash}-${w}.webp`);
      const meta = await sharp(bytes).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: w, height: Math.round((w * 4) / 3) });
    }
    expect([...t.edges.files.files.keys()].some((k) => k.startsWith(`originals/${hash}.`))).toBe(
      true,
    );

    const img = await fetch(`${t.baseUrl}/media/public/${hash}-400.webp`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(img.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${t.baseUrl}/media/public/../secret`)).status).toBe(404);
    expect((await fetch(`${t.baseUrl}/media/public/${'0'.repeat(16)}-400.webp`)).status).toBe(404);
  });
});
