import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq, families, fragrances } from '@lummi/db';
import { fileURLToPath } from 'node:url';
import { seedCatalog } from '../src/catalog/seed';
import { seedCatalogIfEmpty } from '../src/catalog/seed-if-empty';
import { createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

it('seeds an empty catalog and leaves a catalog that has fragrances alone', async () => {
  const seed = vi.fn(async () => {
    await t.db.insert(fragrances).values({
      slug: 'tygar',
      code: '1',
      name: 'Tygar',
      originalBrand: 'Brand',
      type: 'unisex',
      season: 'all_year',
      timeOfDay: 'day',
      longevityRu: 'до 24 часов',
      longevityUz: '24 soatgacha',
      sillage: 'medium',
      descriptionRu: 'd',
      descriptionUz: 'd',
      whenToWearRu: 'w',
      whenToWearUz: 'w',
      keyNotesRu: ['a', 'b', 'c'],
      keyNotesUz: ['a', 'b', 'c'],
    });
  });
  expect(await seedCatalogIfEmpty(t.db, seed)).toBe(true);
  expect(await seedCatalogIfEmpty(t.db, seed)).toBe(false);
  expect(seed).toHaveBeenCalledTimes(1);
});

it('adds only the seed fragrances a catalog lacks, leaving the rest as edited', async () => {
  const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
  await seedCatalog(t.db, { materialsDir, limit: 67 }); // the catalog before 068–082
  // the limited seed still loads the whole dictionary: drop the family only 068–082 use
  await t.db.delete(families).where(eq(families.nameRu, 'Цветочный шипровый'));
  expect(await t.db.select().from(families)).toHaveLength(29);
  await t.db.update(fragrances).set({ descriptionRu: 'edited' }).where(eq(fragrances.code, '001'));

  expect(await seedCatalog(t.db, { materialsDir, onlyMissing: true })).toEqual({ fragrances: 15 });
  expect(await t.db.select().from(fragrances)).toHaveLength(82);
  expect(await t.db.select().from(families)).toHaveLength(30);
  const [edited] = await t.db.select().from(fragrances).where(eq(fragrances.code, '001'));
  expect(edited?.descriptionRu).toBe('edited');
  const [added] = await t.db.select().from(fragrances).where(eq(fragrances.code, '075'));
  expect(added?.name).toBe("L'Impératrice");
  // nothing left to add
  expect(await seedCatalog(t.db, { materialsDir, onlyMissing: true })).toEqual({ fragrances: 0 });
});
