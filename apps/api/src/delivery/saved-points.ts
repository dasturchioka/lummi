import type { SavedPointDto } from '@lummi/contracts';
import { and, btsPoints, desc, eq, notInArray, regions, savedPoints, type DbOrTx } from '@lummi/db';
import { readSettings } from '../settings/settings.service';
import { toPointDto, toRegionDto } from './dto';

/**
 * «Мои пункты BTS» (spec Changes 2026-11-07 BTS point selection, 2026-11-11): the Recipient and
 * BTS point pairs a customer ordered to. Order creation remembers each one in its own transaction;
 * checkout offers them first and Profile lists them. A pair is the recipient phone (E.164) and the
 * point; ordering to it again renames it and moves it first. Nothing here ever touches an order:
 * each order keeps its own snapshot.
 */

/** Remembers the pair of an order to a point, then keeps the `delivery.savedPointsMax` last used. */
export async function rememberPoint(
  tx: DbOrTx,
  pair: {
    customerId: number;
    recipientName: string;
    recipientPhone: string;
    btsPointId: number;
    at: Date;
  },
): Promise<void> {
  await tx
    .insert(savedPoints)
    .values({ ...pair, lastUsedAt: pair.at })
    .onConflictDoUpdate({
      target: [savedPoints.customerId, savedPoints.recipientPhone, savedPoints.btsPointId],
      set: { recipientName: pair.recipientName, lastUsedAt: pair.at },
    });
  const { 'delivery.savedPointsMax': max } = await readSettings(tx, ['delivery.savedPointsMax']);
  const kept = await tx
    .select({ id: savedPoints.id })
    .from(savedPoints)
    .where(eq(savedPoints.customerId, pair.customerId))
    .orderBy(desc(savedPoints.lastUsedAt), desc(savedPoints.id))
    .limit(max);
  await tx.delete(savedPoints).where(
    and(
      eq(savedPoints.customerId, pair.customerId),
      notInArray(
        savedPoints.id,
        kept.map((k) => k.id),
      ),
    ),
  );
}

/**
 * The customer's saved pairs, the last used first, at most `delivery.savedPointsMax` (read here
 * too, so lowering the setting hides the extra pairs at once); a point BTS hid since is flagged.
 */
export async function listSavedPoints(db: DbOrTx, customerId: number): Promise<SavedPointDto[]> {
  const { 'delivery.savedPointsMax': max } = await readSettings(db, ['delivery.savedPointsMax']);
  const rows = await db
    .select({ saved: savedPoints, point: btsPoints, region: regions })
    .from(savedPoints)
    .innerJoin(btsPoints, eq(btsPoints.id, savedPoints.btsPointId))
    .innerJoin(regions, eq(regions.id, btsPoints.regionId))
    .where(eq(savedPoints.customerId, customerId))
    .orderBy(desc(savedPoints.lastUsedAt), desc(savedPoints.id))
    .limit(max);
  return rows.map(({ saved, point, region }) => ({
    id: saved.id,
    recipientName: saved.recipientName,
    recipientPhone: saved.recipientPhone,
    point: toPointDto(point),
    region: toRegionDto(region),
    hidden: !point.active,
    lastUsedAt: saved.lastUsedAt.toISOString(),
  }));
}

/** The pair checkout starts on: the last used whose point is still offered. */
export const defaultSavedPoint = (list: readonly SavedPointDto[]): SavedPointDto | null =>
  list.find((s) => !s.hidden) ?? null;

/** Forgets one of the customer's pairs; false when it is not theirs (or gone). */
export async function removeSavedPoint(
  db: DbOrTx,
  customerId: number,
  id: number,
): Promise<boolean> {
  const gone = await db
    .delete(savedPoints)
    .where(and(eq(savedPoints.id, id), eq(savedPoints.customerId, customerId)))
    .returning({ id: savedPoints.id });
  return gone.length > 0;
}
