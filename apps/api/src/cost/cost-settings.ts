import type { DbOrTx } from '@lummi/db';
import { readSettings } from '../settings/settings.service';
import { COST_SETTING_KEYS, costSettingsFrom, type CostSettings } from './unit-cost';

/** The cost model's settings from the settings store (defaults where the owner set none), in one query. */
export async function readCostSettings(tx: DbOrTx): Promise<CostSettings> {
  return costSettingsFrom(await readSettings(tx, COST_SETTING_KEYS));
}
