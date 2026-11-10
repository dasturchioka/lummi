import type { BuyNowItem } from '@lummi/contracts';
import { SET_SIZE } from '@lummi/contracts/constants';
import { and, eq, fragrances, volumes, type DbOrTx } from '@lummi/db';
import type { StoredLine } from '../cart/load-cart';
import { tenMlOf } from '../sets/sets';

/** The id «Купить сейчас» gives its one line: it is no cart line, but the quote keys lines by id. */
const BUY_NOW_LINE_ID = 1;

/**
 * The one line a «Купить сейчас» item stands for, quantity 1 (spec Changes 2026-11-11): a volume
 * of a visible fragrance, the Discovery set, or a builder set of five visible fragrances that each
 * have a 10 ml. Null when the item names something unknown or no longer sold; whether it is
 * available is the quote's to judge, like any cart line's.
 */
export async function buyNowLine(tx: DbOrTx, item: BuyNowItem): Promise<StoredLine | null> {
  const line = { lineId: BUY_NOW_LINE_ID, qty: 1 };
  switch (item.kind) {
    case 'volume': {
      const [v] = await tx
        .select({ id: volumes.id })
        .from(volumes)
        .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
        .where(
          and(
            eq(fragrances.slug, item.slug),
            eq(fragrances.hidden, false),
            eq(volumes.ml, item.ml),
          ),
        );
      return v ? { ...line, kind: 'volume', volumeId: v.id, fragranceIds: null } : null;
    }
    case 'discovery_set':
      return { ...line, kind: 'discovery_set', volumeId: null, fragranceIds: null };
    case 'builder_set': {
      // a hidden fragrance answers like an unknown one, as the builder does (spec Changes 2026-11-10)
      const five = (await tenMlOf(tx, { slugs: item.slugs })).filter((t) => !t.hidden);
      if (five.length !== SET_SIZE) return null;
      return {
        ...line,
        kind: 'builder_set',
        volumeId: null,
        fragranceIds: five.map((t) => t.fragranceId).sort((a, b) => a - b),
      };
    }
  }
}
