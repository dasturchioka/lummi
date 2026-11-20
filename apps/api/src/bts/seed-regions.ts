import { regions, type DbOrTx } from '@lummi/db';
import { BTS_REGIONS, DEFAULT_TARIFF } from './regions';

/**
 * Makes sure the 14 regions exist. Idempotent: an existing row (by code) is left alone, so a
 * tariff the owner changed is never reset. Runs at API start, in the import, and after a test reset.
 */
export async function seedRegions(db: DbOrTx): Promise<void> {
  await db
    .insert(regions)
    .values(
      BTS_REGIONS.map((r, i) => ({
        code: r.code,
        btsId: r.btsId,
        nameRu: r.nameRu,
        nameUz: r.nameUz,
        deliveryTariff: DEFAULT_TARIFF,
        position: i + 1,
      })),
    )
    .onConflictDoNothing({ target: regions.code });
}
