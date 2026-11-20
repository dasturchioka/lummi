import { and, consumables, eq, fragrances, isNull, type ConsumableRow } from '@lummi/db';
import type { TestApp } from './test-app';

/*
 * Stock in liquid (ADR 0043) for tests: a fragrance's ready concentrate, the bottles it fills, the
 * seeded consumables. Fills are worked out at the cost settings' defaults (filling loss 3 %).
 */

/** One bottle's fill in µl at the default filling loss: ml × 1.03 × 1000. */
export const FILL_UL = { 5: 5_150, 10: 10_300, 30: 30_900, 50: 51_500 } as const;
export type FillMl = keyof typeof FILL_UL;

/** The fragrance's id by slug. */
export async function fragranceIdOf(t: TestApp, slug: string): Promise<number> {
  const [f] = await t.db
    .select({ id: fragrances.id })
    .from(fragrances)
    .where(eq(fragrances.slug, slug));
  if (!f) throw new Error(`no fragrance ${slug}`);
  return f.id;
}

/** Sets a fragrance's ready concentrate, in µl (by slug or id). */
export async function setConcentrateUl(
  t: TestApp,
  fragrance: string | number,
  ul: number,
): Promise<void> {
  const id = typeof fragrance === 'number' ? fragrance : await fragranceIdOf(t, fragrance);
  await t.db.update(fragrances).set({ concentrateUl: ul }).where(eq(fragrances.id, id));
}

/**
 * Leaves the fragrance exactly `bottles` fills of `ml` of concentrate: the new model's «on hand =
 * N» for one volume. Its other volumes then share that liquid (a 50 ml fill makes four 10 ml).
 */
export async function stockBottles(
  t: TestApp,
  fragrance: string | number,
  ml: FillMl,
  bottles: number,
): Promise<void> {
  await setConcentrateUl(t, fragrance, bottles * FILL_UL[ml]);
}

/** The fragrance's ready concentrate, µl. */
export async function concentrateUl(t: TestApp, fragrance: string | number): Promise<number> {
  const id = typeof fragrance === 'number' ? fragrance : await fragranceIdOf(t, fragrance);
  const [f] = await t.db
    .select({ ul: fragrances.concentrateUl })
    .from(fragrances)
    .where(eq(fragrances.id, id));
  return f!.ul;
}

/** The active consumable with this use (and ml): the seeded flacons, boxes and ethanol. */
export async function consumable(
  t: TestApp,
  use: 'flacon' | 'box' | 'ethanol',
  ml: number | null = null,
): Promise<ConsumableRow> {
  const [row] = await t.db
    .select()
    .from(consumables)
    .where(
      and(
        eq(consumables.use, use),
        ml === null ? isNull(consumables.ml) : eq(consumables.ml, ml),
        eq(consumables.archived, false),
      ),
    );
  if (!row) throw new Error(`no ${use} ${ml ?? ''}`);
  return row;
}

export async function setConsumable(t: TestApp, id: number, onHand: number): Promise<void> {
  await t.db.update(consumables).set({ onHand }).where(eq(consumables.id, id));
}
