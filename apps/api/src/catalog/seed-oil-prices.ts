import type { FragranceTier } from '@lummi/contracts';
import { eq, fragrances, type Db } from '@lummi/db';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The oil prices the seed starts from (#75, ADR 0040): the list from the owner's supplier
 * invoices, kept off the repository (it is the customer's commercial data). It lives as a JSON
 * file on the server and the seed reads it only from the path in `OIL_PRICES_FILE`; without the
 * variable or the file the step is skipped. The owner's own values in the admin always win.
 */
export interface OilPriceEntry {
  /** As the list writes it: brand and name in one. */
  name: string;
  tier: FragranceTier | null;
  /** So'm per gram before the supplier discount. */
  oilPrice: number;
  supplier: string | null;
  invoice: string | null;
}

/** How the list spells a brand we spell otherwise. */
const BRAND_SPELLINGS: Record<string, string> = {
  Kilian: 'By Kilian',
  Roja: 'Roja Dove',
  'Marc-Antoine Barrois': 'M.A.B.',
  'Yves Saint Laurent': 'YSL',
  Xerjoff: 'Xerjoff (Sospiro)',
};

/**
 * Whole names the list writes differently from our brand + name, matched by hand
 * (`docs/open-questions.md` asks the customer to confirm them).
 */
const NAME_SPELLINGS: Record<string, string> = {
  'Bvlgari Tygar Extrait': 'Bvlgari Tygar Extrait 2026',
  'Dior Miss Dior Blooming Bouquet': 'Miss Dior Blooming Bouquet',
  'Dior Sauvage EDT': 'Dior Sauvage EDT 2015',
  'Clive Christian Blonde Amber': 'Clive Christian Blond Amber',
  'Hormone Paris Gaba': 'Gaba Harmone Paris',
  'Maison Francis Kurkdjian Baccarat Rouge 540': 'Baccarat Rouge 540',
};

/** Letters and digits only, accents and case dropped: «L'Immensité» = «L'Immensite». */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Pairs each catalog fragrance (by key) with its list entry, by brand + name. */
export function matchOilPrices<K>(
  catalog: readonly { key: K; brand: string; name: string }[],
  list: readonly OilPriceEntry[],
): { matched: Map<K, OilPriceEntry>; unmatchedCatalog: K[]; unmatchedList: string[] } {
  const byKey = new Map(list.map((e) => [fold(e.name), e]));
  const matched = new Map<K, OilPriceEntry>();
  const used = new Set<OilPriceEntry>();
  const unmatchedCatalog: K[] = [];
  for (const f of catalog) {
    const full = `${f.brand} ${f.name}`;
    const spelled = NAME_SPELLINGS[full] ?? `${BRAND_SPELLINGS[f.brand] ?? f.brand} ${f.name}`;
    const hit = byKey.get(fold(spelled));
    if (hit && !used.has(hit)) {
      matched.set(f.key, hit);
      used.add(hit);
    } else unmatchedCatalog.push(f.key);
  }
  return {
    matched,
    unmatchedCatalog,
    unmatchedList: list.filter((e) => !used.has(e)).map((e) => e.name),
  };
}

export type SeedOilPricesResult =
  | { skipped: 'unset' | 'missing' }
  | { filled: number; unmatchedCatalog: string[]; unmatchedList: string[] };

/**
 * The seed step for oil prices: the list at `file` (default `OIL_PRICES_FILE`) onto the catalog by
 * brand + name, each of oil price, tier, supplier and invoice only where it is empty, so nothing
 * the owner set is overwritten. Idempotent. Skips with one log line when there is no file.
 */
export async function seedOilPrices(
  db: Db,
  file: string | undefined = process.env.OIL_PRICES_FILE,
  log: (line: string) => void = console.log,
): Promise<SeedOilPricesResult> {
  if (!file) {
    log('oil prices: OIL_PRICES_FILE is not set, skipped');
    return { skipped: 'unset' };
  }
  if (!existsSync(file)) {
    log(`oil prices: ${file} not found, skipped`);
    return { skipped: 'missing' };
  }
  const list = JSON.parse(readFileSync(file, 'utf8')) as OilPriceEntry[];
  let filled = 0;
  const outcome = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(fragrances)
      .orderBy(fragrances.id) // ascending id, as every other writer locks them
      .for('update');
    const m = matchOilPrices(
      rows.map((f) => ({ key: f.id, brand: f.originalBrand, name: f.name })),
      list,
    );
    for (const f of rows) {
      const e = m.matched.get(f.id);
      if (!e) continue;
      const fill = {
        ...(f.oilPrice === null ? { oilPrice: e.oilPrice } : {}),
        ...(f.tier === null && e.tier ? { tier: e.tier } : {}),
        ...(f.oilSupplier === null && e.supplier ? { oilSupplier: e.supplier } : {}),
        ...(f.oilInvoice === null && e.invoice ? { oilInvoice: e.invoice } : {}),
      };
      if (Object.keys(fill).length === 0) continue;
      await tx.update(fragrances).set(fill).where(eq(fragrances.id, f.id));
      filled++;
    }
    const names = new Map(rows.map((f) => [f.id, f.name]));
    return { unmatchedCatalog: m.unmatchedCatalog.map((id) => names.get(id)!), unmatchedList: m.unmatchedList };
  });
  log(
    `oil prices: ${filled} fragrances filled; no price for ${outcome.unmatchedCatalog.length}, ` +
      `${outcome.unmatchedList.length} in the list are not in the catalog`,
  );
  return { filled, ...outcome };
}
