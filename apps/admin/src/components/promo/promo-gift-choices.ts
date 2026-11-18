import type { serverApi } from '@/lib/server-api';
import type { PromoGiftChoice } from './promo-form';

/**
 * The fragrances a gift code may give (ADR 0039), by name, each with the volumes it is sold in.
 * Hidden ones are listed too: the cart refuses a hidden gift as «Подарок закончился». An empty
 * list when the catalog does not load: the form then offers the Discovery set alone.
 */
export async function promoGiftChoicesOf(
  api: Awaited<ReturnType<typeof serverApi>>,
): Promise<PromoGiftChoice[]> {
  const res = await api.catalog.fragrances.list({ query: {} });
  if (res.status !== 200) return [];
  return res.body
    .map((f) => ({
      id: f.id,
      name: f.name,
      volumes: f.volumes.map((v) => v.ml).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
