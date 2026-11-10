import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fragrances } from '@lummi/db';
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
