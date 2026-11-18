import type { FragranceCosts, UnitCost, VolumeCost } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import Link from 'next/link';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

/** The parts in the calculator's order; a part that costs nothing is left out. */
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

const LINK =
  'font-medium text-foreground underline decoration-border-strong underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-current';

/** «62 %»: the server's ratio as a whole percent, the sign kept. */
const percent = (ratio: number) => `${Math.round(ratio * 100)}\u00a0%`;

/**
 * The fragrance page's cost block (ADR 0040): each saved volume's unit cost, part by part, against
 * its price, as the API computes it from the saved oil price and the cost settings. Read only:
 * the figures change when the form is saved or a setting changes.
 */
export function CostBlock({
  costs,
  saved,
  language,
  t,
}: {
  costs: FragranceCosts | null;
  /** False on a fragrance not saved yet: nothing to compute. */
  saved: boolean;
  language: Language;
  t: AdminMessages;
}) {
  const c = t.catalog;
  const money = (n: number) => formatMoney(n, language);
  const note = (text: string) => (
    <p className="max-w-[70ch] text-small text-pretty text-muted-foreground">{text}</p>
  );
  if (!saved) return note(c.costAfterSave);
  if (!costs || costs.oilPrice === null || costs.landedOilPrice === null) return note(c.costNoOil);
  return (
    <div className="grid gap-5" data-testid="cost-block">
      <div className="grid max-w-[70ch] gap-1 text-small text-pretty text-muted-foreground">
        <p>
          {c.costFromSaved}{' '}
          <Link href="/settings#area-costLiquid" className={LINK}>
            {c.costSettings}
          </Link>
        </p>
        <p className="tabular-nums">{fill(c.landedOil, { price: money(costs.landedOilPrice) })}</p>
      </div>
      {/* one column per volume from 1024 px, split by hairlines, as the volume editor above */}
      <div className="grid divide-y divide-border lg:-mx-6 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {costs.volumes.map((v) => (
          <VolumeColumn key={v.ml} v={v} money={money} t={t} />
        ))}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</dt>
      <dd
        className={`shrink-0 text-right whitespace-nowrap tabular-nums ${strong ? 'font-semibold' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function VolumeColumn({
  v,
  money,
  t,
}: {
  v: VolumeCost;
  money: (n: number) => string;
  t: AdminMessages;
}) {
  const c = t.catalog;
  const cost = v.cost;
  if (!cost) return null;
  // the regular price or an active markdown below the cost
  const loss = (v.profit ?? 0) < 0 || (v.markdownProfit ?? 0) < 0;
  return (
    <section
      className="grid content-start gap-3 py-5 text-sm first:pt-0 last:pb-0 lg:px-6 lg:py-0"
      aria-labelledby={`cost-${v.ml}`}
    >
      <h3 id={`cost-${v.ml}`} className="text-[15px] font-semibold tabular-nums">
        {v.ml} {c.ml}
      </h3>
      <dl className="grid gap-1.5">
        {PARTS.filter((k) => cost[k] !== 0).map((k) => (
          <Row key={k} label={c.costParts[k]} value={money(cost[k])} />
        ))}
      </dl>
      <dl className="grid gap-1.5 border-t border-border pt-3">
        <Row label={c.costTotal} value={money(cost.total)} strong />
        <Row label={c.costPrice} value={money(v.price)} />
        {v.profit !== null && <Row label={c.costProfit} value={money(v.profit)} strong />}
        {v.margin !== null && <Row label={c.costMargin} value={percent(v.margin)} />}
      </dl>
      {v.markdownPrice !== null && v.markdownProfit !== null && (
        <div className="grid gap-1.5 border-t border-border pt-3">
          <p className="text-small text-muted-foreground">
            {fill(c.costMarkdown, { price: money(v.markdownPrice) })}
          </p>
          <dl className="grid gap-1.5">
            <Row label={c.costProfit} value={money(v.markdownProfit)} strong />
            {v.markdownMargin !== null && (
              <Row label={c.costMargin} value={percent(v.markdownMargin)} />
            )}
          </dl>
        </div>
      )}
      {loss && <p className="text-small font-medium">{c.costLoss}</p>}
    </section>
  );
}
