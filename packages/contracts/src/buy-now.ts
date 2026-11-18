import { DISCOVERY_SETS, DISCOVERY_VIAL_MLS, SET_SIZE, type DiscoveryVialMl } from './constants';

/**
 * «Купить сейчас»: the one item a one-line checkout buys, without touching the cart (spec Changes
 * 2026-11-07 cart, 2026-11-11). Zod-free, so the Mini App builds and reads the same text it sends
 * as `item` (the checkout query and the order body) without the schema runtime (ADR 0030); it
 * imports `@lummi/contracts/buy-now`.
 *
 * As text: `volume:<slug>:<ml>`, `discovery_set` (the 5 × 10 ml set), `discovery_set:5` (the 5 × 5 ml
 * set, ADR 0042), or `builder_set:<slug>,<slug>,<slug>,<slug>,<slug>`
 * (five different fragrances, ADR 0009). Slugs are ASCII kebab case (ADR 0016), so `:` and `,`
 * never occur inside one.
 */
export type BuyNowItem =
  | { kind: 'volume'; slug: string; ml: 10 | 30 | 50 }
  | { kind: 'discovery_set'; vialMl: DiscoveryVialMl }
  | { kind: 'builder_set'; slugs: string[] };

/** The longest `item` text: five slugs of the 100 characters a slug may have, and the separators. */
export const BUY_NOW_ITEM_MAX = 540;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The item as the `item` text the checkout and the order take. */
export function buyNowParam(item: BuyNowItem): string {
  switch (item.kind) {
    case 'volume':
      return `volume:${item.slug}:${item.ml}`;
    case 'discovery_set':
      return DISCOVERY_SETS[item.vialMl].buyNow;
    case 'builder_set':
      return `builder_set:${item.slugs.join(',')}`;
  }
}

/** The item an `item` text names; null when it is not one (a builder needs five different slugs). */
export function parseBuyNowParam(text: string): BuyNowItem | null {
  if (text.length > BUY_NOW_ITEM_MAX) return null;
  const set = DISCOVERY_VIAL_MLS.find((ml) => DISCOVERY_SETS[ml].buyNow === text);
  if (set !== undefined) return { kind: 'discovery_set', vialMl: set };
  const [kind, ...rest] = text.split(':');
  if (kind === 'volume' && rest.length === 2) {
    const [slug, ml] = rest as [string, string];
    if (!SLUG.test(slug) || (ml !== '10' && ml !== '30' && ml !== '50')) return null;
    return { kind: 'volume', slug, ml: Number(ml) as 10 | 30 | 50 };
  }
  if (kind === 'builder_set' && rest.length === 1) {
    const slugs = rest[0]!.split(',');
    if (
      slugs.length !== SET_SIZE ||
      new Set(slugs).size !== SET_SIZE ||
      !slugs.every((s) => SLUG.test(s))
    )
      return null;
    return { kind: 'builder_set', slugs };
  }
  return null;
}
