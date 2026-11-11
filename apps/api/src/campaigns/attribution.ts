import { and, campaignOpens, desc, eq, gte, type DbOrTx } from '@lummi/db';
import { readSettings } from '../settings/settings.service';

/**
 * The link an order takes as its source (ADR 0022): the last one the customer opened within
 * `campaigns.attributionWindowDays` before `now`. The window is exactly N x 24 h and inclusive: an
 * open N x 24 h old still counts, a millisecond older does not. Whatever the promo code did, this
 * stands: a refused prefill still leaves its source.
 */
export async function attributedLinkId(
  tx: DbOrTx,
  customerId: number,
  now: Date,
): Promise<number | null> {
  const s = await readSettings(tx, ['campaigns.attributionWindowDays']);
  const since = new Date(now.getTime() - s['campaigns.attributionWindowDays'] * 86_400_000);
  const [last] = await tx
    .select({ linkId: campaignOpens.linkId })
    .from(campaignOpens)
    .where(and(eq(campaignOpens.customerId, customerId), gte(campaignOpens.openedAt, since)))
    .orderBy(desc(campaignOpens.openedAt), desc(campaignOpens.id))
    .limit(1);
  return last?.linkId ?? null;
}
