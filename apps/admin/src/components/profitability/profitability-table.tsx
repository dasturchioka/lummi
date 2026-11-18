import type { ProfitabilityRow, ProfitabilityTable } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { HowCounted } from '@/components/reports/report-chrome';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { cn, fill } from '@/lib/utils';
import { percent, percentValue } from './cost-rows';
import { hrefOf, type SortKey, type View } from './view';

const LINK =
  'font-medium text-foreground underline decoration-border-strong underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-current';

/** The figure each sortable column sorts by; null sorts last either way. */
const VALUE: Record<Exclude<SortKey, 'name'>, (r: ProfitabilityRow) => number | null> = {
  price: (r) => r.price - r.discount,
  cost: (r) => r.unitCost,
  orderCosts: (r) => r.orderCosts,
  profit: (r) => r.profit,
  margin: (r) => r.margin,
};

function rowsOf(data: ProfitabilityTable, view: View, setName: string): ProfitabilityRow[] {
  const shown = data.rows.filter((r) =>
    view.ml === 'all'
      ? true
      : view.ml === 'set'
        ? r.kind === 'discovery_set'
        : r.kind === 'volume' && String(r.ml) === view.ml,
  );
  const sign = view.dir === 'asc' ? 1 : -1;
  const name = (r: ProfitabilityRow) => (r.kind === 'discovery_set' ? setName : r.name);
  return [...shown].sort((a, b) => {
    if (view.sort === 'name') return name(a).localeCompare(name(b)) * sign || a.ml - b.ml;
    const x = VALUE[view.sort](a);
    const y = VALUE[view.sort](b);
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return (x - y) * sign || name(a).localeCompare(name(b));
  });
}

/**
 * «Все ароматы» (#77): one sale of every fragrance volume and of the Discovery set on the chosen
 * channel, sortable by any figure (in the URL), a loss or a margin under the floor marked. A row's
 * name opens it in the calculator. A table from 768 px of content, one block per row below.
 */
export function ProfitabilityTableView({
  data,
  view,
  language,
  t,
}: {
  data: ProfitabilityTable;
  view: View;
  language: Language;
  t: AdminMessages;
}) {
  const p = t.profitability;
  const money = (n: number) => formatMoney(n, language);
  if (data.rows.length === 0) return <EmptyState title={p.empty}>{p.emptyText}</EmptyState>;
  const rows = rowsOf(data, view, p.discoverySet);
  // the filter's figures as the API counted them (the server owns money)
  const summary = data.summaries.find((x) => x.volume === view.ml);
  const floor = percentValue(data.lowMarginPercent);

  const name = (r: ProfitabilityRow) => (r.kind === 'discovery_set' ? p.discoverySet : r.name);
  const volume = (r: ProfitabilityRow) =>
    r.kind === 'discovery_set'
      ? fill(p.setVolume, { n: String(data.set.size), ml: String(data.set.vialMl) })
      : fill(p.ml, { ml: String(r.ml) });
  const calculatorHref = (r: ProfitabilityRow) =>
    r.kind === 'discovery_set'
      ? hrefOf(view, { tab: 'calculator', set: true })
      : hrefOf(view, { tab: 'calculator', set: false, fragrance: r.fragranceId, calcMl: r.ml });
  const flag = (r: ProfitabilityRow) =>
    r.flag === 'loss' ? (
      <Badge tone="look">{p.flags.loss}</Badge>
    ) : r.flag === 'low' ? (
      <Badge tone="calm">{fill(p.flags.low, { percent: floor })}</Badge>
    ) : null;
  const markers = (r: ProfitabilityRow) =>
    [r.hidden && p.hidden, r.markedDown && p.markedDown].filter(Boolean).join(' · ');

  const columns: { key: SortKey; label: string; numeric: boolean }[] = [
    { key: 'name', label: p.columns.name, numeric: false },
    { key: 'price', label: p.columns.price, numeric: true },
    { key: 'cost', label: p.columns.cost, numeric: true },
    { key: 'orderCosts', label: p.columns.orderCosts, numeric: true },
    { key: 'profit', label: p.columns.profit, numeric: true },
    { key: 'margin', label: p.columns.margin, numeric: true },
  ];
  const sortHref = (key: SortKey) =>
    hrefOf(view, {
      sort: key,
      dir:
        view.sort === key ? (view.dir === 'asc' ? 'desc' : 'asc') : key === 'name' ? 'asc' : 'desc',
    });
  const header = (c: (typeof columns)[number]) => {
    const on = view.sort === c.key;
    const Arrow = view.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <Link
        href={sortHref(c.key)}
        scroll={false}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm transition-colors duration-150 hover:text-foreground',
          on && 'font-semibold text-foreground',
        )}
      >
        {c.label}
        {on && <Arrow className="size-3.5" strokeWidth={1.75} aria-hidden />}
        <span className="sr-only">{fill(p.sortBy, { column: c.label })}</span>
      </Link>
    );
  };
  const price = (r: ProfitabilityRow) =>
    r.discount > 0 ? (
      <>
        <span className="block">{num(r.price - r.discount)}</span>
        <s className="block text-small text-muted-foreground">{num(r.price)}</s>
      </>
    ) : (
      num(r.price)
    );
  const th = 'h-auto px-3 py-2 align-bottom leading-tight whitespace-normal';
  const td = 'px-3 text-right whitespace-nowrap';

  return (
    <div className="grid gap-3">
      {summary && (
        <MetaLine
          className="px-1 text-small text-muted-foreground"
          parts={[
            `${p.summary.rows} ${num(summary.rows)}`,
            summary.averageProfit !== null && (
              <>
                {p.summary.average}{' '}
                <span className="font-semibold text-foreground tabular-nums">
                  {money(summary.averageProfit)}
                </span>
              </>
            ),
            <>
              {p.summary.loss}{' '}
              <span className="font-semibold text-foreground tabular-nums">
                {num(summary.loss)}
              </span>
            </>,
            <>
              {fill(p.summary.low, { percent: floor })}{' '}
              <span className="font-semibold text-foreground tabular-nums">{num(summary.low)}</span>
            </>,
            summary.noOil > 0 && (
              <>
                {p.summary.noOil}{' '}
                <span className="font-semibold text-foreground tabular-nums">
                  {num(summary.noOil)}
                </span>
              </>
            ),
          ]}
        />
      )}

      {rows.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">{p.noneInFilter}</Card>
      ) : (
        <Card className="@container">
          {/* narrow: one block per sale, its profit leading */}
          <ul className="divide-y divide-border @3xl:hidden">
            {rows.map((r) => (
              <li key={`${r.kind}${r.fragranceId}-${r.ml}`} className="grid gap-1 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={calculatorHref(r)} className={cn(LINK, 'min-w-0 break-words')}>
                    {name(r)}
                  </Link>
                  <span className="shrink-0 font-semibold whitespace-nowrap tabular-nums">
                    {r.profit === null ? '—' : money(r.profit)}
                  </span>
                </div>
                <MetaLine
                  className="text-small text-muted-foreground tabular-nums"
                  parts={[
                    volume(r),
                    `${p.columns.price} ${money(r.price - r.discount)}`,
                    r.unitCost === null ? p.noOil : `${p.columns.cost} ${money(r.unitCost)}`,
                    r.margin !== null && `${p.columns.margin} ${percent(r.margin)}`,
                    markers(r),
                  ]}
                />
                {flag(r) && <div>{flag(r)}</div>}
              </li>
            ))}
          </ul>
          <div className="hidden @3xl:block">
            <p className="px-5 pt-4 pb-1 text-right text-small text-muted-foreground">{p.inSom}</p>
            <Table className="text-[13px]">
              <THead>
                <TR>
                  {columns.map((c) => (
                    <TH
                      key={c.key}
                      className={cn(th, c.numeric && 'text-right')}
                      aria-sort={
                        view.sort === c.key
                          ? view.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                    >
                      {c.key === 'name' ? (
                        <span className="flex items-end gap-6">
                          {header(c)}
                          <span className="ml-auto">{p.columns.ml}</span>
                        </span>
                      ) : (
                        header(c)
                      )}
                    </TH>
                  ))}
                  <TH className={th}>
                    <span className="sr-only">{t.profitability.excel.flag}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={`${r.kind}${r.fragranceId}-${r.ml}`}>
                    <TD className="px-3">
                      <div className="flex items-baseline gap-6">
                        <div className="min-w-0">
                          <Link href={calculatorHref(r)} className={cn(LINK, 'break-words')}>
                            {name(r)}
                          </Link>
                          {(r.brand || markers(r)) && (
                            <MetaLine
                              className="text-small text-muted-foreground"
                              parts={[
                                r.brand && fill(t.reports.attribution, { brand: r.brand }),
                                markers(r),
                              ]}
                            />
                          )}
                        </div>
                        <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">
                          {volume(r)}
                        </span>
                      </div>
                    </TD>
                    <TD className={td}>{price(r)}</TD>
                    <TD className={td}>
                      {r.unitCost === null ? (
                        <span className="text-small text-muted-foreground">{p.noOil}</span>
                      ) : (
                        num(r.unitCost)
                      )}
                    </TD>
                    <TD className={td}>{r.orderCosts === null ? '—' : num(r.orderCosts)}</TD>
                    <TD className={cn(td, 'font-semibold')}>
                      {r.profit === null ? '—' : num(r.profit)}
                    </TD>
                    <TD className={td}>{r.margin === null ? '—' : percent(r.margin)}</TD>
                    <TD className="px-3 pr-5">{flag(r)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      <HowCounted r={p} className="px-1">
        <p>{p.tableHint}</p>
        <p>{p.afterSetHint}</p>
        <p>
          {p.giftHint}
          {data.giftSampleCost !== null && ` ${money(data.giftSampleCost)}.`}
        </p>
        <p>
          <Link href="/settings#area-costOrder" className={LINK}>
            {p.settingsLink}
          </Link>
        </p>
      </HowCounted>
    </div>
  );
}
