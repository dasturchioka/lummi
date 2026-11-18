import type { PurchasePlan } from '@lummi/contracts';
import { formatMoney, plural, type Language } from '@lummi/i18n';
import { Download } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { OilReceiptDraftsButton } from '@/components/purchase/oil-receipt-drafts-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { planQueryString } from '@/lib/purchase-query';
import { num } from '@/lib/setting-copy';
import { cn, fill } from '@/lib/utils';

const HEADING = 'font-display text-[13px] leading-[1.35] tracking-[0.2em] uppercase';

/** One labelled figure; `tone` weights it (a total) or mutes it (a part that is taken off). */
function Line({
  label,
  value,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'sum' | 'muted';
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-2.5',
        tone === 'muted' && 'text-muted-foreground',
      )}
    >
      <dt className="min-w-0 text-sm text-pretty">{label}</dt>
      <dd
        className={cn(
          'text-right tabular-nums whitespace-nowrap',
          tone === 'sum' ? 'font-semibold' : 'font-medium',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className={HEADING}>{title}</h2>
      <dl className="mt-2 divide-y divide-border">{children}</dl>
    </Card>
  );
}

/**
 * The owner's purchase planner «Закупка и оборот» (#78): the what-if form, the calculator's
 * figures and the per-fragrance table. It only lays out what the API computed (`planPurchase`).
 * The form is a plain GET: the inputs live in the URL, nothing is stored.
 */
export function PurchasePlanView({
  t,
  language,
  plan,
  query,
}: {
  t: AdminMessages;
  language: Language;
  plan: PurchasePlan;
  query: { kg?: number; by?: string };
}) {
  const p = t.purchase;
  const money = (n: number) => formatMoney(n, language);
  const litres = (ml: number) => fill(p.litres, { n: num(Math.round(ml / 100) / 10) });
  const percent = (x: number | null) => (x === null ? '—' : `${num(Math.round(x * 100))}%`);
  const { inputs: i, year } = plan;
  const profitTone = (n: number) => (n < 0 ? ('muted' as const) : ('sum' as const));
  const edited = query.kg !== undefined || Boolean(query.by);

  return (
    <>
      <PageHeader
        title={p.title}
        description={p.description}
        actions={
          <Button asChild variant="outline">
            <a
              href={`/api/admin/purchase-plan/export?${planQueryString(query, language)}`}
              download
            >
              <Download strokeWidth={1.5} aria-hidden />
              {p.export}
            </a>
          </Button>
        }
      />

      <Card className="mb-4 p-4 lg:mb-6 lg:p-5">
        <form
          id="plan-form"
          method="get"
          action="/purchase"
          className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_auto] sm:items-end"
        >
          <Field id="plan-kg" label={p.defaultKg}>
            <Input
              id="plan-kg"
              name="kg"
              type="text"
              inputMode="decimal"
              defaultValue={String(i.oilKgPerFragrance)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">{p.apply}</Button>
            {edited && (
              <Button asChild variant="outline">
                <Link href="/purchase">{p.reset}</Link>
              </Button>
            )}
          </div>
        </form>
        <p className="mt-3 text-small text-muted-foreground">
          {p.whatIf}{' '}
          <Link
            href="/settings"
            className="underline decoration-border-strong underline-offset-[3px]"
          >
            {p.toSettings}
          </Link>
        </p>
      </Card>

      {plan.withoutOilPrice.length > 0 && (
        <div className="mb-4 lg:mb-6">
          <Notice title={plural(language, plan.withoutOilPrice.length, p.noOilPrice)}>
            {plan.withoutOilPrice.map((f) => f.name).join(', ')}
          </Notice>
        </div>
      )}

      {plan.fragranceCount === 0 ? (
        <EmptyState title={p.empty} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          <Block title={p.investmentTitle}>
            <Line label={p.oil} value={money(plan.investment.oil)} />
            <Line label={p.ethanol} value={money(plan.investment.ethanol)} />
            <Line label={p.liquidTotal} value={money(plan.investment.total)} tone="sum" />
          </Block>

          <Block title={p.outputTitle}>
            <Line label={p.perfume} value={litres(plan.liquid.perfumeMl)} />
            <Line
              label={fill(p.giftLiquid, { count: num(i.giftSampleCount), ml: num(i.giftSampleMl) })}
              value={litres(plan.liquid.giftMl)}
              tone="muted"
            />
            <Line label={p.bottles10} value={num(plan.bottles.ml10)} />
            <Line label={p.bottles30} value={num(plan.bottles.ml30)} />
            <Line label={p.bottles50} value={num(plan.bottles.ml50)} />
            <Line label={p.bottlesTotal} value={num(plan.bottles.total)} tone="sum" />
          </Block>

          <Block title={p.sellAllTitle}>
            <Line label={p.revenueFull} value={money(plan.revenue.full)} tone="muted" />
            <Line
              label={fill(p.discount, { percent: num(i.avgDiscountPercent) })}
              value={`−${money(plan.revenue.discount)}`}
              tone="muted"
            />
            <Line label={p.revenueNet} value={money(plan.revenue.net)} tone="sum" />
            <Line
              label={`${p.giftCost} (${num(i.giftSampleCount)} × ${money(plan.gift.unitCost)})`}
              value={`−${money(plan.gift.total)}`}
              tone="muted"
            />
            <Line label={p.profit} value={money(plan.profit)} tone="sum" />
            <Line label={p.margin} value={percent(plan.margin)} tone={profitTone(plan.profit)} />
            <p className="py-2.5 text-small text-muted-foreground">{p.costsNote}</p>
          </Block>

          <div className="grid content-start gap-4 lg:gap-6">
            <Block title={fill(p.yearTitle, { percent: num(i.soldPercent) })}>
              <Line label={p.soldBottles} value={num(year.soldBottles)} />
              <Line label={p.yearRevenue} value={money(year.revenue)} tone="sum" />
              <Line label={p.yearProfit} value={money(year.profit)} />
              <Line
                label={fill(p.fixedCosts, { month: money(i.fixedPerMonth) })}
                value={`−${money(year.fixedCosts)}`}
                tone="muted"
              />
              <Line label={p.yearNet} value={money(year.net)} tone="sum" />
              <Line label={`${p.yearNet}, ${p.perMonth}`} value={money(year.netPerMonth)} />
              <Line label={p.stockAtCost} value={money(year.stockAtCost)} tone="muted" />
            </Block>
            <Block title={p.paybackTitle}>
              <Line
                label={p.paybackUnits}
                value={plan.payback.units === null ? p.neverPaysBack : num(plan.payback.units)}
                tone="sum"
              />
              <Line label={p.paybackShare} value={percent(plan.payback.share)} />
            </Block>
          </div>

          <Card className="p-0 lg:col-span-2">
            <div className="px-4 pt-4 sm:px-5 sm:pt-5">
              <h2 className={HEADING}>{p.tableTitle}</h2>
              <p className="mt-2 text-small text-muted-foreground">{p.tableHint}</p>
              <div className="mt-3">
                <OilReceiptDraftsButton rows={plan.rows} t={t} />
              </div>
            </div>
            <Table className="mt-2">
              <THead>
                <TR>
                  <TH>{p.fragrance}</TH>
                  <TH className="text-right">{p.oilKg}</TH>
                  <TH className="text-right">{p.oilCost}</TH>
                  <TH className="text-right">{p.bottles}</TH>
                  <TH className="text-right">{p.revenue}</TH>
                  <TH className="text-right">{p.rowProfit}</TH>
                </TR>
              </THead>
              <TBody>
                {plan.rows.map((r) => (
                  <TR key={r.fragranceId}>
                    <TD className="min-w-48">
                      <span className="font-semibold">{r.name}</span>
                      <span className="block text-small text-muted-foreground">{r.brand}</span>
                    </TD>
                    <TD className="w-28 text-right">
                      <Input
                        form="plan-form"
                        name={`k${r.fragranceId}`}
                        type="text"
                        inputMode="decimal"
                        aria-label={`${p.oilKg}: ${r.name}`}
                        defaultValue={r.overridden ? String(r.oilKg) : ''}
                        placeholder={String(r.oilKg)}
                        className="h-9 text-right"
                      />
                    </TD>
                    <TD className="text-right whitespace-nowrap">{money(r.oilCost)}</TD>
                    <TD className="text-right">{num(r.bottles)}</TD>
                    <TD className="text-right whitespace-nowrap">{money(r.revenue)}</TD>
                    <TD
                      className={cn(
                        'text-right font-semibold whitespace-nowrap',
                        r.profit < 0 && 'text-muted-foreground',
                      )}
                    >
                      {money(r.profit)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
