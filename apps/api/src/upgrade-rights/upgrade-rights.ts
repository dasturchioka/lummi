import { SINGLE_RIGHT_ML, type UpgradeRightPrice } from '@lummi/contracts';
import {
  and,
  asc,
  eq,
  gt,
  isNull,
  upgradeRights,
  type DbOrTx,
  type OrderLineRow,
  type OrderRow,
  type UpgradeRightRow,
  type VolumeRow,
} from '@lummi/db';
import { readPricingSettings } from '../pricing/pricing-settings';
import { quote, type Entitlement } from '../pricing/quote';
import { readSettings } from '../settings/settings.service';
import { lastDayOf, rightTerm } from './right-term';

/**
 * Upgrade rights (TZ §3.4, ADR 0003, ticket #38): opened by a delivered set or single 10 ml
 * bottle, they discount one Full size bottle of a covered fragrance once. Their state is derived,
 * never stored (ADR 0005): active while no order holds them, they are not closed and `expires_at`
 * has not come. The money itself is `quote()`'s.
 */

type InsertRight = typeof upgradeRights.$inferInsert;

/**
 * On «Доставлен» (the `deliver` move, in its transaction): each set unit opens one right covering
 * the five fragrances of its snapshot (ADR 0009); while the 10 ml source is switched on, each
 * fragrance bought as a single 10 ml bottle opens one, however many of it were bought. The 10 ml
 * bottles inside a set are the set's, never single bottles. Percent and term come from the
 * source's settings now and stay on the right. Idempotent on the source line and unit.
 */
export async function openUpgradeRights(
  tx: DbOrTx,
  order: OrderRow,
  lines: readonly OrderLineRow[],
  now: Date,
): Promise<UpgradeRightRow[]> {
  const s = await readSettings(tx, [
    'upgradeRights.set.enabled',
    'upgradeRights.set.percent',
    'upgradeRights.set.validityDays',
    'upgradeRights.single10ml.enabled',
    'upgradeRights.single10ml.percent',
    'upgradeRights.single10ml.validityDays',
  ]);
  const base = (source: InsertRight['source'], percent: number, validityDays: number) => ({
    customerId: order.customerId,
    source,
    sourceOrderId: order.id,
    percent,
    openedAt: now,
    expiresAt: rightTerm(now, validityDays).expiresAt,
  });

  const rows: InsertRight[] = [];
  const singles = new Set<number>();
  for (const line of lines) {
    if (line.kind !== 'volume') {
      if (!s['upgradeRights.set.enabled'] || !line.setComposition) continue;
      for (let unit = 0; unit < line.qty; unit++)
        rows.push({
          ...base('set', s['upgradeRights.set.percent'], s['upgradeRights.set.validityDays']),
          sourcePosition: line.position,
          sourceUnit: unit,
          fragrances: line.setComposition,
        });
    } else if (
      s['upgradeRights.single10ml.enabled'] &&
      line.ml === SINGLE_RIGHT_ML &&
      line.fragranceId !== null &&
      !singles.has(line.fragranceId)
    ) {
      singles.add(line.fragranceId);
      rows.push({
        ...base(
          'single_10ml',
          s['upgradeRights.single10ml.percent'],
          s['upgradeRights.single10ml.validityDays'],
        ),
        sourcePosition: line.position,
        sourceUnit: 0,
        fragrances: [{ fragranceId: line.fragranceId, name: line.nameRu, brand: line.brand ?? '' }],
      });
    }
  }
  if (rows.length === 0) return [];
  return tx
    .insert(upgradeRights)
    .values(rows)
    .onConflictDoNothing({
      target: [upgradeRights.sourceOrderId, upgradeRights.sourcePosition, upgradeRights.sourceUnit],
    })
    .returning();
}

/**
 * A returned source order (TZ §3.4: «Если заказ с набором отменён/возвращён — право закрывается»)
 * closes every right it opened, held or not: one already spent stays with the order that used it,
 * no clawback (ADR 0005), and a cancel of that order no longer gives it back.
 */
export async function closeUpgradeRightsOpenedBy(
  tx: DbOrTx,
  sourceOrderId: number,
  now: Date,
): Promise<void> {
  await tx
    .update(upgradeRights)
    .set({ closedAt: now })
    .where(and(eq(upgradeRights.sourceOrderId, sourceOrderId), isNull(upgradeRights.closedAt)));
}

/** The customer's rights no order holds, not closed and not ended, soonest to end first. */
export function activeUpgradeRights(tx: DbOrTx, customerId: number, now: Date) {
  return tx
    .select()
    .from(upgradeRights)
    .where(
      and(
        eq(upgradeRights.customerId, customerId),
        isNull(upgradeRights.usedByOrderId),
        isNull(upgradeRights.closedAt),
        gt(upgradeRights.expiresAt, now),
      ),
    )
    .orderBy(asc(upgradeRights.expiresAt), asc(upgradeRights.id));
}

/** A right as `quote()` takes it: its own percent, the fragrances it covers. */
export function toEntitlement(r: UpgradeRightRow): Extract<Entitlement, { type: 'upgrade_right' }> {
  return {
    type: 'upgrade_right',
    id: r.id,
    source: r.source,
    percent: r.percent,
    fragranceIds: r.fragrances.map((f) => f.fragranceId),
    expiresAt: r.expiresAt,
  };
}

/**
 * The fragrance card's «Скидка за набор» prices (TZ §3.4 «Отображение»): for each Full size volume
 * of the fragrance, the price of one bottle with the customer's best covering right, as `quote()`
 * prices a cart of that bottle alone (ADR 0001, 0007; a marked-down volume only when the setting
 * allows it, ADR 0008). Delivery is left out: the label is about the bottle.
 */
export async function upgradeRightPrices(
  tx: DbOrTx,
  customerId: number,
  fragranceId: number,
  volumes: readonly VolumeRow[],
  now: Date,
): Promise<UpgradeRightPrice[]> {
  const covering = (await activeUpgradeRights(tx, customerId, now)).filter((r) =>
    r.fragrances.some((f) => f.fragranceId === fragranceId),
  );
  if (covering.length === 0) return [];
  const settings = await readPricingSettings(tx);
  const out: UpgradeRightPrice[] = [];
  for (const v of volumes) {
    if (v.ml !== 30 && v.ml !== 50) continue;
    const q = quote({
      lines: [
        {
          key: String(v.id),
          item: { kind: 'volume', fragranceId, volumeMl: v.ml },
          qty: 1,
          price: {
            regular: v.price,
            markdown: v.salePrice === null ? null : { price: v.salePrice, endsAt: v.saleEndsAt },
          },
          soldOut: false,
        },
      ],
      entitlements: covering.map(toEntitlement),
      promoCode: null,
      choice: null,
      deliveryTariff: 0,
      settings,
      now,
    });
    const applied = q.discount;
    if (applied?.type !== 'upgrade_right') continue;
    const right = covering.find((r) => r.id === applied.id)!;
    out.push({
      ml: v.ml,
      price: q.total,
      source: right.source,
      percent: right.percent,
      lastDay: lastDayOf(right.expiresAt),
    });
  }
  return out;
}
