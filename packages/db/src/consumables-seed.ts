import type { ConsumableUnit, ConsumableUse } from '@lummi/contracts/constants';

/**
 * The consumables the migration `0043_liquid_stock` seeds (ADR 0043), in its order: a flacon of
 * every ml, a box of every ml sold alone, the spirit. The test harness puts them back after its
 * truncate; the migration test checks the two agree.
 */
export const SEEDED_CONSUMABLES: readonly {
  nameRu: string;
  nameUz: string;
  unit: ConsumableUnit;
  use: ConsumableUse;
  ml: number | null;
  lowThreshold: number;
}[] = [
  { nameRu: 'Флакон 5 мл', nameUz: 'Flakon 5 ml', unit: 'pcs', use: 'flacon', ml: 5, lowThreshold: 20 },
  { nameRu: 'Флакон 10 мл', nameUz: 'Flakon 10 ml', unit: 'pcs', use: 'flacon', ml: 10, lowThreshold: 20 },
  { nameRu: 'Флакон 30 мл', nameUz: 'Flakon 30 ml', unit: 'pcs', use: 'flacon', ml: 30, lowThreshold: 20 },
  { nameRu: 'Флакон 50 мл', nameUz: 'Flakon 50 ml', unit: 'pcs', use: 'flacon', ml: 50, lowThreshold: 20 },
  { nameRu: 'Коробка 10 мл', nameUz: 'Quti 10 ml', unit: 'pcs', use: 'box', ml: 10, lowThreshold: 20 },
  { nameRu: 'Коробка 30 мл', nameUz: 'Quti 30 ml', unit: 'pcs', use: 'box', ml: 30, lowThreshold: 20 },
  { nameRu: 'Коробка 50 мл', nameUz: 'Quti 50 ml', unit: 'pcs', use: 'box', ml: 50, lowThreshold: 20 },
  { nameRu: 'Спирт', nameUz: 'Spirt', unit: 'ml', use: 'ethanol', ml: null, lowThreshold: 1000 },
];
