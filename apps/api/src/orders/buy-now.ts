import type { BuyNowItem } from '@lummi/contracts';
import { and, eq, fragrances, sellableVolume, volumes, type DbOrTx } from '@lummi/db';
import type { StoredLine } from '../cart/load-cart';
import { judgeBuilderPick, tenMlOf } from '../sets/sets';

/** The id «Купить сейчас» gives its one line: it is no cart line, but the quote keys lines by id. */
const BUY_NOW_LINE_ID = 1;

/**
 * The one line a «Купить сейчас» item stands for, quantity 1 (spec Changes 2026-11-11): a volume
 * of a visible fragrance (never a 5 ml bottle, ADR 0042), a Discovery set, or a builder set of five visible fragrances that each
 * have a 10 ml. Null when the item names something unknown or no longer sold; whether it is
 * available is the quote's to judge, like any cart line's.
 */
export async function buyNowLine(tx: DbOrTx, item: BuyNowItem): Promise<StoredLine | null> {
  const line = { lineId: BUY_NOW_LINE_ID, qty: 1, setKey: null };
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
            sellableVolume(),
          ),
        );
      return v ? { ...line, kind: 'volume', volumeId: v.id, fragranceIds: null } : null;
    }
    case 'discovery_set':
      return {
        ...line,
        kind: 'discovery_set',
        volumeId: null,
        fragranceIds: null,
        setKey: item.key,
      };
    case 'builder_set': {
      // the builder's own judge: five different visible fragrances with a 10 ml (a hidden one
      // answers like an unknown one); a 10 ml that is short is the quote's to flag, not a 404
      const found = await tenMlOf(tx, { slugs: item.slugs });
      const picked = judgeBuilderPick(item.slugs, found);
      if (!picked.ok && picked.reason !== 'unavailable') return null;
      const five = found.filter((t) => !t.hidden && item.slugs.includes(t.slug));
      return {
        ...line,
        kind: 'builder_set',
        volumeId: null,
        fragranceIds: five.map((t) => t.fragranceId).sort((a, b) => a - b),
      };
    }
  }
}
