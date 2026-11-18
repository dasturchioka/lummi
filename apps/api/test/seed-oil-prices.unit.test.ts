import { MAX_OIL_PRICE } from '@lummi/contracts';
import type { Db } from '@lummi/db';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadOilPriceList,
  matchOilPrices,
  seedOilPrices,
  type OilPriceEntry,
} from '../src/catalog/seed-oil-prices';

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

describe('reading the oil price file: a bad file or row never stops the deploy', () => {
  const dir = () => mkdtemp(join(tmpdir(), 'oil-list-'));
  async function file(content: string): Promise<string> {
    const f = join(await dir(), 'oil-prices.json');
    await writeFile(f, content);
    return f;
  }
  const collect = () => {
    const lines: string[] = [];
    return { lines, log: (l: string) => void lines.push(l) };
  };

  it('reads a valid list as it is', async () => {
    const c = collect();
    const res = loadOilPriceList(await file(JSON.stringify(LIST)), c.log);
    expect(res).toEqual({ ok: true, entries: LIST, rejected: 0 });
    expect(c.lines).toEqual([]);
  });

  it.each([
    ['unset', undefined, 'unset'],
    ['empty', '', 'unset'],
    ['missing', '/nonexistent/oil-prices.json', 'missing'],
  ] as const)('skips with one line when the path is %s', (_n, path, skipped) => {
    const c = collect();
    expect(loadOilPriceList(path, c.log)).toEqual({ ok: false, skipped });
    expect(c.lines).toHaveLength(1);
  });

  it.each([
    ['bad JSON', '{"name": "YSL Libre", oilPrice: '],
    ['not a list', JSON.stringify({ name: 'YSL Libre', oilPrice: 1000 })],
  ])('skips the whole fill with one line on %s', async (_n, content) => {
    const c = collect();
    expect(loadOilPriceList(await file(content), c.log)).toEqual({ ok: false, skipped: 'unreadable' });
    expect(c.lines).toHaveLength(1);
  });

  it('skips the whole fill with one line when the path is a directory', async () => {
    const c = collect();
    expect(loadOilPriceList(await dir(), c.log)).toEqual({ ok: false, skipped: 'unreadable' });
    expect(c.lines).toHaveLength(1);
  });

  it('drops each bad row with one line naming it and why, and keeps the good ones', async () => {
    const good = entry('YSL Libre', 1005);
    const rows = [
      good,
      { ...entry('Zero Price', 0) },
      { ...entry('Fraction Price', 1000.5) },
      { ...entry('Too Dear', MAX_OIL_PRICE + 1) },
      { ...entry('Text Price', 1000), oilPrice: '1000' },
      { ...entry('Gold Tier', 1000), tier: 'gold' },
      { ...entry('Long Supplier', 1000), supplier: 'x'.repeat(121) },
      { ...entry('', 1000) },
      null,
      { ...entry('Null Tier', 1001), tier: null, supplier: null, invoice: null },
    ];
    const c = collect();
    const res = loadOilPriceList(await file(JSON.stringify(rows)), c.log);
    expect(res).toEqual({
      ok: true,
      entries: [good, { ...entry('Null Tier', 1001), tier: null, supplier: null, invoice: null }],
      rejected: 8,
    });
    expect(c.lines).toHaveLength(8);
    for (const [i, name] of ['Zero Price', 'Fraction Price', 'Too Dear', 'Text Price', 'Gold Tier', 'Long Supplier'].entries()) {
      expect(c.lines[i]).toContain(name);
    }
    expect(c.lines[1]).toContain('oilPrice');
    expect(c.lines[4]).toContain('tier');
    expect(c.lines[5]).toContain('supplier');
    expect(c.lines[6]).toContain('row 8');
    expect(c.lines[7]).toContain('row 9');
  });

  it('the seed step returns the skip without touching the database', async () => {
    const c = collect();
    const noDb = new Proxy({}, { get: () => { throw new Error('database touched'); } }) as Db;
    await expect(seedOilPrices(noDb, await dir(), c.log)).resolves.toEqual({ skipped: 'unreadable' });
    expect(c.lines).toHaveLength(1);
  });
});
