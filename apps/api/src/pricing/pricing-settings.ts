import type { DbOrTx } from '@lummi/db';
import { readSettings } from '../settings/settings.service';
import type { PricingSettings } from './quote';

/** The settings `quote()` reads, from the settings store (defaults where the owner set none). */
export async function readPricingSettings(tx: DbOrTx): Promise<PricingSettings> {
  const s = await readSettings(tx, [
    'pricing.freeDeliveryThreshold',
    'pricing.thresholdBase',
    'pricing.discountsApplyToMarkedDown',
    'pricing.fullSizeVolumesMl',
    'entitlements.setDiscountScope',
  ]);
  return {
    freeDeliveryThreshold: s['pricing.freeDeliveryThreshold'],
    thresholdBase: s['pricing.thresholdBase'],
    discountsApplyToMarkedDown: s['pricing.discountsApplyToMarkedDown'],
    fullSizeVolumesMl: s['pricing.fullSizeVolumesMl'],
    setDiscountScope: s['entitlements.setDiscountScope'],
  };
}
