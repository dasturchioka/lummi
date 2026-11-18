import type { OrderProfit, UnitCost } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { Badge } from '@/components/ui/badge';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';

/*
 * The breakdowns of «Рентабельность» (#77), shared by the calculator, the order simulator and the
 * order page's profit block: the API's figures in the calculator's order, never recomputed here.
 */

/** «42 %»: the server's ratio as a whole percent, the sign kept. */
export const percent = (ratio: number) => `${Math.round(ratio * 100)}\u00a0%`;

/** A setting's percent as typed («20,5»), the decimal comma both languages write. */
export const percentValue = (n: number) => String(n).replace('.', ',');

/** The unit cost's parts in the calculator's order; a part that costs nothing is left out. */
const PARTS = [
  'oil',
  'ethanol',
  'bottle',
  'label',
  'spray',
  'filling',
  'box',
  'insert',
  'defect',
] as const satisfies readonly (keyof UnitCost)[];

export function Row({
  label,
  value,
  note,
  strong,
  className,
}: {
  label: string;
  value: string;
  /** A muted line under the label (how a figure is made up). */
  note?: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <dt className={cn('min-w-0', strong ? 'font-medium' : 'text-muted-foreground')}>
        {label}
        {note && (
          <span className="block text-small text-muted-foreground tabular-nums">{note}</span>
        )}
      </dt>
      <dd
        className={cn(
          'shrink-0 text-right whitespace-nowrap tabular-nums',
          strong && 'font-semibold',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** One unit's cost part by part, then its total. */
export function UnitCostRows({
  cost,
  language,
  t,
}: {
  cost: UnitCost;
  language: Language;
  t: AdminMessages;
}) {
  const c = t.catalog;
  const money = (n: number) => formatMoney(n, language);
  return (
    <dl className="grid gap-1.5 text-sm">
      {PARTS.filter((k) => cost[k] !== 0).map((k) => (
        <Row key={k} label={c.costParts[k]} value={money(cost[k])} />
      ))}
      <Row
        label={c.costTotal}
        value={money(cost.total)}
        strong
        className="mt-1.5 border-t border-border pt-2.5"
      />
    </dl>
  );
}

/**
 * A sale's or an order's costs in the calculator's order: goods, then its Order costs (mailer, BTS
 * less what the customer paid, the commission, ad, tax, the gift sample), then the whole cost. Each row the channel
 * has no part in is left out (no mailer or BTS on Uzum, no online payment at 0 %).
 */
export function OrderCostRows({
  sale,
  language,
  t,
  goodsLabel,
}: {
  sale: OrderProfit;
  language: Language;
  t: AdminMessages;
  /** The goods row's label when the goods are one unit («Себестоимость»). */
  goodsLabel?: string;
}) {
  const p = t.profitability.costs;
  const money = (n: number) => formatMoney(n, language);
  const app = sale.channel === 'miniapp';
  const delivery = sale.btsCharge - sale.deliveryPaid;
  return (
    <dl className="grid gap-1.5 text-sm">
      <Row label={goodsLabel ?? p.goods} value={money(sale.goods)} />
      {app && <Row label={p.mailer} value={money(sale.mailer)} />}
      {app && (
        <Row
          label={p.delivery}
          value={money(delivery)}
          note={fill(p.deliveryParts, {
            charge: money(sale.btsCharge),
            paid: money(sale.deliveryPaid),
          })}
        />
      )}
      {(sale.commission !== 0 || !app) && (
        <Row
          label={fill(app ? p.commissionMiniapp : p.commissionUzum, {
            percent: percentValue(sale.commissionPercent),
          })}
          value={money(sale.commission)}
        />
      )}
      <Row label={p.ad} value={money(sale.adPerSale)} />
      <Row
        label={fill(p.tax, { percent: percentValue(sale.taxPercent) })}
        value={money(sale.tax)}
      />
      {sale.giftSample !== 0 && <Row label={p.giftSample} value={money(sale.giftSample)} />}
      <Row
        label={p.cost}
        value={money(sale.cost)}
        strong
        className="mt-1.5 border-t border-border pt-2.5"
      />
    </dl>
  );
}

/**
 * The bottom line: profit large with its margin beside it, on a Milk Field plate. A loss reads in
 * Ink 600 with the «needs a look» badge, never red (the No Alarm rule); a margin under the floor
 * gets the quiet badge.
 */
export function ProfitLine({
  sale,
  lowMarginPercent,
  language,
  t,
}: {
  sale: OrderProfit;
  /** The table's floor; without it no low-margin badge. */
  lowMarginPercent?: number;
  language: Language;
  t: AdminMessages;
}) {
  const p = t.profitability;
  const loss = sale.profit < 0;
  const low =
    !loss &&
    lowMarginPercent !== undefined &&
    sale.margin !== null &&
    sale.margin * 100 < lowMarginPercent;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 rounded-button bg-field px-4 py-3">
      <div className="min-w-0">
        <p className="text-small text-muted-foreground">{p.costs.profit}</p>
        <p className="text-[22px] leading-tight font-semibold whitespace-nowrap tabular-nums">
          {formatMoney(sale.profit, language)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {loss && <Badge tone="look">{p.flags.loss}</Badge>}
        {low && (
          <Badge tone="calm">
            {fill(p.flags.low, { percent: percentValue(lowMarginPercent!) })}
          </Badge>
        )}
        {sale.margin !== null && (
          <p className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">
            {p.costs.margin}{' '}
            <span className="text-[17px] font-semibold text-foreground">
              {percent(sale.margin)}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
