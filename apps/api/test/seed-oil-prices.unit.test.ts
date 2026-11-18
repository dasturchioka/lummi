import { describe, expect, it } from 'vitest';
import { matchOilPrices, type OilPriceEntry } from '../src/catalog/seed-oil-prices';

/**
 * Matching the owner's oil price list to the catalog by brand + name (#75). The list's spellings
 * are the real ones; prices, suppliers and invoices are made up (the real list stays off the
 * repository).
 */
const entry = (name: string, oilPrice: number): OilPriceEntry => ({
  name,
  tier: 'premium',
  oilPrice,
  supplier: 'Test Oils',
  invoice: 'INV-1',
});

const LIST = [
  entry('Louis Vuitton Meteore', 1001),
  entry('Maison Crivelli Oud Maracuja', 1002),
  entry('By Kilian Good Girl Gone Bad', 1003),
  entry('M.A.B. Ganymede', 1004),
  entry('YSL Libre', 1005),
  entry('Roja Dove Elysium Pour Homme Parfum', 1006),
  entry('Xerjoff (Sospiro) Erba Pura', 1007),
  entry('Bvlgari Tygar Extrait 2026', 1008),
  entry('Miss Dior Blooming Bouquet', 1009),
  entry('Dior Sauvage EDT 2015', 1010),
  entry('Clive Christian Blond Amber', 1011),
  entry('Gaba Harmone Paris', 1012),
  entry('Baccarat Rouge 540', 1013),
  entry('Some Brand Not Sold Here', 1014),
];
const CATALOG = [
  ['030', 'Louis Vuitton', 'Météore'],
  ['037', 'Maison Crivelli', 'Oud Maracujá'],
  ['006', 'Kilian', 'Good Girl Gone Bad'],
  ['042', 'Marc-Antoine Barrois', 'Ganymede'],
  ['062', 'Yves Saint Laurent', 'Libre'],
  ['053', 'Roja', 'Elysium Pour Homme Parfum'],
  ['060', 'Xerjoff', 'Erba Pura'],
  ['005', 'Bvlgari', 'Tygar Extrait'],
  ['012', 'Dior', 'Miss Dior Blooming Bouquet'],
  ['013', 'Dior', 'Sauvage EDT'],
  ['014', 'Clive Christian', 'Blonde Amber'],
  ['026', 'Hormone Paris', 'Gaba'],
  ['040', 'Maison Francis Kurkdjian', 'Baccarat Rouge 540'],
  ['050', 'Parfums de Marly', 'Greenley'],
].map(([key, brand, name]) => ({ key: key!, brand: brand!, name: name! }));

describe('matching the oil price list to the catalog by brand and name', () => {
  const m = matchOilPrices(CATALOG, LIST);
  const price = (code: string) => m.matched.get(code)?.oilPrice;

  it('matches across accents and the list\'s brand spellings', () => {
    expect([price('030'), price('037'), price('006'), price('042'), price('062'), price('053'), price('060')]).toEqual([
      1001, 1002, 1003, 1004, 1005, 1006, 1007,
    ]);
  });

  it('takes the whole names the list writes differently', () => {
    expect([price('005'), price('012'), price('013'), price('014'), price('026'), price('040')]).toEqual([
      1008, 1009, 1010, 1011, 1012, 1013,
    ]);
  });

  it('carries tier, supplier and invoice with the price', () => {
    expect(m.matched.get('030')).toMatchObject({ tier: 'premium', supplier: 'Test Oils', invoice: 'INV-1' });
  });

  it('reports what is left on either side', () => {
    expect(m.unmatchedCatalog).toEqual(['050']);
    expect(m.unmatchedList).toEqual(['Some Brand Not Sold Here']);
  });

  it('gives one list entry to one fragrance only', () => {
    const twice = matchOilPrices(
      [
        { key: 'a', brand: 'YSL', name: 'Libre' },
        { key: 'b', brand: 'Yves Saint Laurent', name: 'Libre' },
      ],
      [entry('YSL Libre', 1)],
    );
    expect([...twice.matched.keys()]).toEqual(['a']);
    expect(twice.unmatchedCatalog).toEqual(['b']);
  });
});
