import type { ConsumableUnit, ConsumableUse } from '@lummi/contracts/constants';

interface SeededConsumable {
  nameRu: string;
  nameUz: string;
  unit: ConsumableUnit;
  use: ConsumableUse;
  ml: number | null;
  lowThreshold: number;
  /** Counted by nobody yet: the catalog seed fills a placeholder count (`seedConsumables`). */
  isPlaceholder: true;
}

const item = (
  nameRu: string,
  nameUz: string,
  unit: ConsumableUnit,
  use: ConsumableUse,
  ml: number | null,
  lowThreshold: number,
): SeededConsumable => ({ nameRu, nameUz, unit, use, ml, lowThreshold, isPlaceholder: true });

/**
 * The consumables the migration `0043_liquid_stock` seeds (ADR 0043), in its order: a flacon of
 * every ml, a box of every ml sold alone, the spirit. The test harness puts them back after its
 * truncate; the migration test checks the two agree.
 */
export const SEEDED_CONSUMABLES: readonly SeededConsumable[] = [
  item('Флакон 5 мл', 'Flakon 5 ml', 'pcs', 'flacon', 5, 20),
  item('Флакон 10 мл', 'Flakon 10 ml', 'pcs', 'flacon', 10, 20),
  item('Флакон 30 мл', 'Flakon 30 ml', 'pcs', 'flacon', 30, 20),
  item('Флакон 50 мл', 'Flakon 50 ml', 'pcs', 'flacon', 50, 20),
  item('Коробка 10 мл', 'Quti 10 ml', 'pcs', 'box', 10, 20),
  item('Коробка 30 мл', 'Quti 30 ml', 'pcs', 'box', 30, 20),
  item('Коробка 50 мл', 'Quti 50 ml', 'pcs', 'box', 50, 20),
  item('Спирт', 'Spirt', 'ml', 'ethanol', null, 1000),
];
