import type { OrderProfit, ProfitabilityItem, SalesChannel, UnitCost } from '@lummi/contracts';
import { saleProfit } from '../cost/order-costs';
import type { CostSettings } from '../cost/unit-cost';
import { quote, type Entitlement, type Price, type PricingSettings } from '../pricing/quote';

/** One line of a sale the owner makes up: what it sells, its price now and its unit cost. */
export interface SaleLine {
  item: ProfitabilityItem;
  name: string;
  brand: string | null;
  /** The bottle's ml, or a set's vial ml. */
  ml: number;
  qty: number;
  price: Price;
  /** `bottleCost` / `setCost`; null without an oil price. */
  unitCost: UnitCost | null;
}

export interface SaleContext {
  channel: SalesChannel;
  /** «Скидка после набора»: the set's upgrade right at this percent; null when off. */
  afterSetDiscountPercent: number | null;
  /** «С пробником»: one gift sample's cost; null when off. */
  giftSample: number | null;
  /** The delivery tariff below the free-delivery threshold (Mini App). */
  deliveryTariff: number;
  pricing: PricingSettings;
  cost: CostSettings;
  now: Date;
}

export interface CostedSale {
  lines: (SaleLine & { unitPrice: number; markedDown: boolean; lineTotal: number })[];
  itemsSubtotal: number;
  discount: number;
  deliveryFee: number;
  amountToFreeDelivery: number;
  /** Null when a line has no unit cost. */
  profit: OrderProfit | null;
}

/** The made-up right of the after-set discount: one id, no expiry within the sale. */
const RIGHT_ID = 1;

/**
 * A sale the owner makes up on the «Рентабельность» page (#77): its lines priced by the shop's own
 * `quote()` (ADR 0001), so markdowns, the after-set discount (one upgrade right: the dearest Full
 * size bottle of the sale, ADR 0007, never a set) and delivery are what a customer would get,
 * then the calculator's order costs on its goods. Uzum sells at the regular price, with no
 * delivery. For one line this is the calculator's «Все ароматы» row; for several, its order
 * screen, except that one right discounts one bottle. Pure.
 */
export function costSale(lines: readonly SaleLine[], ctx: SaleContext): CostedSale {
  const uzum = ctx.channel === 'uzum';
  const fragranceIds = lines.flatMap((l) => (l.item.kind === 'volume' ? [l.item.fragranceId] : []));
  const entitlements: Entitlement[] =
    ctx.afterSetDiscountPercent === null
      ? []
      : [
          {
            type: 'upgrade_right',
            id: RIGHT_ID,
            source: 'set',
            percent: ctx.afterSetDiscountPercent,
            fragranceIds,
            expiresAt: new Date(ctx.now.getTime() + 86_400_000),
          },
        ];
  const q = quote({
    lines: lines.map((l, i) => ({
      key: String(i),
      item:
        l.item.kind === 'volume'
          ? { kind: 'volume', fragranceId: l.item.fragranceId, volumeMl: l.ml }
          : { kind: 'set' },
      qty: l.qty,
      price: uzum ? { regular: l.price.regular, markdown: null } : l.price,
      soldOut: false,
    })),
    entitlements,
    promoCode: null,
    choice: entitlements.length ? { type: 'upgrade_right', id: RIGHT_ID } : null,
    deliveryTariff: uzum ? 0 : ctx.deliveryTariff,
    settings: ctx.pricing,
    now: ctx.now,
  });
  const priced = lines.map((l, i) => {
    const p = q.lines[i]!;
    return { ...l, unitPrice: p.unitPrice, markedDown: p.markedDown, lineTotal: p.lineTotal };
  });
  const discount = q.discount?.amount ?? 0;
  const known = lines.every((l) => l.unitCost !== null);
  return {
    lines: priced,
    itemsSubtotal: q.itemsSubtotal,
    discount,
    deliveryFee: q.deliveryFee,
    amountToFreeDelivery: uzum ? 0 : q.amountToFreeDelivery,
    profit: known
      ? saleProfit(
          {
            channel: ctx.channel,
            revenue: q.itemsSubtotal - discount,
            goods: lines.reduce((s, l) => s + l.unitCost!.total * l.qty, 0),
            deliveryPaid: q.deliveryFee,
            giftSample: ctx.giftSample ?? 0,
          },
          ctx.cost,
        )
      : null,
  };
}
