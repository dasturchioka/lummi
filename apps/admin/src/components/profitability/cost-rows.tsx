import type { OrderCosts, UnitCost } from '@lummi/contracts';
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
 * A sale's or an order's costs in the calculator's order: goods, mailer, BTS (less what the
 * customer paid), the commission, ad, tax, the gift sample, then the total. Each row the channel
 * has no part in is left out (no mailer or BTS on Uzum, no online payment at 0 %).
 */
export function OrderCostRows({
  costs,
  language,
  t,
  goodsLabel,
}: {
  costs: OrderCosts;
  language: Language;
  t: AdminMessages;
  /** The goods row's label when the goods are one unit («Себестоимость»). */
  goodsLabel?: string;
}) {
  const p = t.profitability.costs;
  const money = (n: number) => formatMoney(n, language);
  const app = costs.channel === 'miniapp';
  const delivery = costs.btsCharge - costs.deliveryPaid;
  return (
    <dl className="grid gap-1.5 text-sm">
      <Row label={goodsLabel ?? p.goods} value={money(costs.goods)} />
      {app && <Row label={p.mailer} value={money(costs.mailer)} />}
      {app && (
        <Row
          label={p.delivery}
          value={money(delivery)}
          note={fill(p.deliveryParts, {
            charge: money(costs.btsCharge),
            paid: money(costs.deliveryPaid),
          })}
        />
      )}
      {(costs.commission !== 0 || !app) && (
        <Row
          label={fill(app ? p.commissionMiniapp : p.commissionUzum, {
            percent: percentValue(costs.commissionPercent),
          })}
          value={money(costs.commission)}
        />
      )}
      <Row label={p.ad} value={money(costs.adPerSale)} />
      <Row
        label={fill(p.tax, { percent: percentValue(costs.taxPercent) })}
        value={money(costs.tax)}
      />
      {costs.giftSample !== 0 && <Row label={p.giftSample} value={money(costs.giftSample)} />}
      <Row
        label={p.total}
        value={money(costs.total)}
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
  costs,
  lowMarginPercent,
  language,
  t,
}: {
  costs: OrderCosts;
  /** The table's floor; without it no low-margin badge. */
  lowMarginPercent?: number;
  language: Language;
  t: AdminMessages;
}) {
  const p = t.profitability;
  const loss = costs.profit < 0;
  const low =
    !loss &&
    lowMarginPercent !== undefined &&
    costs.margin !== null &&
    costs.margin * 100 < lowMarginPercent;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 rounded-button bg-field px-4 py-3">
      <div className="min-w-0">
        <p className="text-small text-muted-foreground">{p.costs.profit}</p>
        <p className="text-[22px] leading-tight font-semibold whitespace-nowrap tabular-nums">
          {formatMoney(costs.profit, language)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {loss && <Badge tone="look">{p.flags.loss}</Badge>}
        {low && (
          <Badge tone="calm">
            {fill(p.flags.low, { percent: percentValue(lowMarginPercent!) })}
          </Badge>
        )}
        {costs.margin !== null && (
          <p className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">
            {p.costs.margin}{' '}
            <span className="text-[17px] font-semibold text-foreground">
              {percent(costs.margin)}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
