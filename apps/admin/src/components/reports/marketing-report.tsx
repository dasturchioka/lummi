import {
  CAMPAIGN_SOURCES,
  NO_PROMO_CODE,
  NO_SOURCE,
  type CampaignSource,
  type MarketingFigures,
  type MarketingReport,
  type ReportLink,
} from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { MetaLine } from '@/components/ui/meta-line';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { cn } from '@/lib/utils';
import { HowCounted, ReportRange, ReportTabs } from './report-chrome';

const HEADING = 'font-display text-[13px] leading-[1.35] tracking-[0.2em] uppercase';

type Copy = AdminMessages['reports'];
type Money = (n: number) => string;

/**
 * The owner's marketing reports (#43): what promo codes, campaign links (by the order's link and by
 * the customer's first link) and the set discount brought in over the range, from the sales
 * report's orders. It only lays out what the API computed (`marketingSummary`).
 */
export function MarketingReportView({
  t,
  language,
  data,
  asked,
  codes,
  invalid,
}: {
  t: AdminMessages;
  language: Language;
  data: MarketingReport;
  /** The range the URL asked for, empty for the default one. */
  asked: { from?: string; to?: string };
  /** Every promo code, for the code filter. */
  codes: string[];
  /** The asked range was refused; `data` is the default range. */
  invalid: boolean;
}) {
  const r = t.reports;
  const m = r.marketing;
  const money = (n: number) => formatMoney(n, language);
  const sourceName = t.campaigns.sources;
  // the filters as the API read them ride in the URL, the export and the reset
  const filters = Object.fromEntries(
    Object.entries(data.filters).filter((e): e is [string, string] => e[1] !== null),
  );
  const exportHref = `/api/admin/reports/marketing/export?${new URLSearchParams({
    from: data.from,
    to: data.to,
    ...filters,
    lang: language,
  })}`;

  return (
    <>
      <PageHeader
        title={r.title}
        description={m.description}
        actions={
          <Button asChild variant="outline">
            <a href={exportHref} download>
              <Download strokeWidth={1.5} aria-hidden />
              {r.export}
            </a>
          </Button>
        }
      />
      <ReportTabs r={r} current="marketing" asked={asked} />
      <ReportRange
        r={r}
        page="marketing"
        range={data}
        asked={asked}
        invalid={invalid}
        resetKeep={filters}
        note={Object.keys(filters).length > 0 ? m.filters.hint : undefined}
        fields={
          <>
            <Field id="r-source" label={m.filters.source}>
              <Select name="source" defaultValue={data.filters.source ?? ''}>
                <option value="">{m.filters.all}</option>
                {CAMPAIGN_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {sourceName[s]}
                  </option>
                ))}
                <option value={NO_SOURCE}>{m.filters.noSource}</option>
              </Select>
            </Field>
            <Field id="r-code" label={m.filters.code}>
              <Select name="code" defaultValue={data.filters.code ?? ''}>
                <option value="">{m.filters.all}</option>
                {codes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={NO_PROMO_CODE}>{m.filters.noCode}</option>
              </Select>
            </Field>
          </>
        }
      />

      {nothingIn(data) ? (
        <EmptyState title={m.empty}>{m.emptyText}</EmptyState>
      ) : (
        <div className="grid gap-4 lg:gap-6">
          <PromoCodes r={r} data={data} money={money} sourceName={sourceName} />
          <Sources r={r} data={data} money={money} sourceName={sourceName} />
          <Acquisition r={r} data={data} money={money} sourceName={sourceName} />
          <Rights r={r} data={data} money={money} />
        </div>
      )}
    </>
  );
}

const quiet = (f: MarketingFigures) => f.orders === 0 && f.refunds === 0;

/** Nothing happened in the range: no order, refund, open, first open or right. */
function nothingIn(d: MarketingReport) {
  return (
    d.promoCodes.length === 0 &&
    d.sources.every((s) => quiet(s) && s.opens === 0) &&
    quiet(d.withoutLink) &&
    quiet(d.earlierCustomers) &&
    quiet(d.withoutFirstLink) &&
    d.acquisition.every((a) => quiet(a) && a.acquired === 0) &&
    d.upgradeRights.every((u) => quiet(u) && u.issued === 0)
  );
}

/** `75,0 %`: one decimal, as the API rounded it; «—» when there is nothing to divide by. */
function percent(p: number | null) {
  return p === null ? '—' : `${p.toFixed(1).replace('.', ',')}\u00a0%`;
}

/** A code breaks anywhere when it must (`BLOGER_MALIKA_NOVOGODNIY_2026_UZ`); words do not. */
const CODE = 'wrap-anywhere';

/** A link as the owner named it: its label («Малика»), or its code when it has none. */
function LinkName({ link }: { link: ReportLink }) {
  return link.sourceLabel ? <>{link.sourceLabel}</> : <span className={CODE}>{link.code}</span>;
}

/** A link's second line: its code when a label named it, and the promo code it prefills. */
function linkDetail(l: ReportLink) {
  const parts = [l.sourceLabel ? l.code : null, l.promoCode].filter(Boolean);
  return parts.length ? <span className={CODE}>{parts.join(' · ')}</span> : undefined;
}

/** One figure: its header, the table's bare number, the phone's value (money with «сум»). */
type Column<R> = {
  key: string;
  label: string;
  cell: (row: R) => string;
  /** Money: the phone shows it with the currency; the table's caption names it once. */
  money?: (row: R) => number | null;
  strong?: boolean;
};

/** A row of a report table: a promo code, a Source or one of its links, a set discount. */
type Row<R> = {
  key: string;
  name: ReactNode;
  detail?: ReactNode;
  /** A link under its Source. */
  nested?: boolean;
  /** Nothing in the range: muted. */
  muted?: boolean;
  data: R;
};
/** Rows with nothing in the range, folded into one muted line naming them. */
type Folded = { key: string; folded: string[]; label: string };
type Line<R> = Row<R> | Folded;

/** Orders, customers (new ones in brackets) and the money: what every marketing table shows. */
function figureColumns<R extends MarketingFigures>(r: Copy): Column<R>[] {
  const f = r.marketing.figures;
  return [
    { key: 'orders', label: f.orders, cell: (x) => num(x.orders) },
    customersColumn<R>(r),
    ...moneyColumns<R>(r),
  ];
}

/** «2 (1)»: customers, and in brackets those whose first Fulfilled order is here. */
function customersColumn<R extends MarketingFigures>(r: Copy): Column<R> {
  return {
    key: 'customers',
    label: r.marketing.figures.customersFirstTime,
    cell: (x) => `${num(x.customers)} (${num(x.firstTimeBuyers)})`,
  };
}

function moneyColumns<R extends MarketingFigures>(r: Copy): Column<R>[] {
  const f = r.marketing.figures;
  const som = (key: 'itemsBeforeDiscount' | 'discount' | 'refunds' | 'net', strong = false) => ({
    key,
    label: f[key],
    cell: (x: R) => num(x[key]),
    money: (x: R) => x[key],
    strong,
  });
  return [
    som('itemsBeforeDiscount'),
    som('discount'),
    som('refunds'),
    som('net', true),
    {
      key: 'averageCheck',
      label: f.averageCheck,
      cell: (x) => (x.averageCheck === null ? '—' : num(x.averageCheck)),
      money: (x) => x.averageCheck,
    },
  ];
}

function RowName<R>({ row }: { row: Row<R> }) {
  return (
    <>
      <span className={cn('block break-words', row.nested ? 'font-medium' : 'font-semibold')}>
        {row.name}
      </span>
      {row.detail && (
        <span className="block text-small break-words text-muted-foreground">{row.detail}</span>
      )}
    </>
  );
}

/**
 * A report table: a dense table of bare numbers under one caption naming the currency on wide
 * screens (DESIGN.md, admin money tables), one block per row on phones (net first, then the
 * counts, then the money).
 */
function FiguresTable<R extends MarketingFigures>({
  r,
  title,
  nameLabel,
  columns,
  lines,
  money,
  hint,
  empty,
}: {
  r: Copy;
  title: string;
  nameLabel: string;
  columns: Column<R>[];
  lines: Line<R>[];
  money: Money;
  hint: string;
  /** Said instead of the table when there are no rows. */
  empty?: string;
}) {
  const th = 'h-auto py-2 align-bottom leading-tight whitespace-normal px-1.5';
  const td = 'px-1.5 text-right whitespace-nowrap';
  const value = (c: Column<R>, row: R) => {
    if (!c.money) return c.cell(row);
    const v = c.money(row);
    return v === null ? '—' : money(v);
  };
  const part = (c: Column<R>, row: R) => (
    <span key={c.key} className="whitespace-nowrap">
      {c.label} <span className="text-foreground tabular-nums">{value(c, row)}</span>
    </span>
  );
  const net = r.marketing.figures.net;
  return (
    <Card className="@container">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-1 @4xl:px-5 @4xl:pt-5">
        <h2 className={HEADING}>{title}</h2>
        {lines.length > 0 && (
          <p className="hidden text-small text-muted-foreground @4xl:block">{r.inSom}</p>
        )}
      </div>
      {lines.length === 0 ? (
        <p className="px-4 pt-2 text-sm text-muted-foreground @4xl:px-5">{empty}</p>
      ) : (
        <>
          <ul className="divide-y divide-border @4xl:hidden">
            {lines.map((line) =>
              'folded' in line ? (
                <li key={line.key} className="px-4 py-2 text-xs text-muted-foreground/80">
                  {line.label}: {line.folded.join(' · ')}
                </li>
              ) : (
                <li
                  key={line.key}
                  className={cn('grid gap-1 py-3.5 pr-4', line.nested ? 'pl-8' : 'pl-4')}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cn('min-w-0', line.muted && 'text-muted-foreground')}>
                      <RowName row={line} />
                    </span>
                    <span className="shrink-0 text-right font-semibold whitespace-nowrap tabular-nums">
                      <span className="sr-only">{net}: </span>
                      {money(line.data.net)}
                    </span>
                  </div>
                  <MetaLine
                    className="text-small text-muted-foreground"
                    parts={columns.filter((c) => !c.money).map((c) => part(c, line.data))}
                  />
                  <MetaLine
                    className="text-small text-muted-foreground"
                    parts={columns
                      .filter((c) => c.money && c.key !== 'net')
                      .map((c) => part(c, line.data))}
                  />
                </li>
              ),
            )}
          </ul>
          <div className="hidden @4xl:block">
            <Table className="text-[13px]">
              <THead>
                <TR>
                  <TH className={cn(th, 'pl-5')}>{nameLabel}</TH>
                  {columns.map((c) => (
                    <TH key={c.key} className={cn(th, 'text-right')}>
                      {c.label}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {lines.map((line) =>
                  'folded' in line ? (
                    <TR key={line.key} className="text-xs text-muted-foreground/80">
                      <TD colSpan={columns.length + 1} className="py-2 pr-2 pl-5">
                        {line.label}: {line.folded.join(' · ')}
                      </TD>
                    </TR>
                  ) : (
                    <TR key={line.key} className={cn(line.muted && 'text-muted-foreground')}>
                      <TD
                        className={cn('w-40 min-w-32 py-2.5 pr-2', line.nested ? 'pl-9' : 'pl-5')}
                      >
                        <RowName row={line} />
                      </TD>
                      {columns.map((c) => (
                        <TD key={c.key} className={cn(td, c.strong && 'font-semibold')}>
                          {c.cell(line.data)}
                        </TD>
                      ))}
                    </TR>
                  ),
                )}
              </TBody>
            </Table>
          </div>
        </>
      )}
      <HowCounted r={r} className="px-4 pt-1 pb-2 @4xl:px-5 @4xl:pb-3">
        <p>{hint}</p>
      </HowCounted>
    </Card>
  );
}

type SectionProps = {
  r: Copy;
  data: MarketingReport;
  money: Money;
  sourceName: Record<CampaignSource, string>;
};

/** Promo codes: the code, where its links are, then its figures, opens and conversion. */
function PromoCodes({ r, data, money, sourceName }: SectionProps) {
  const m = r.marketing;
  type P = MarketingReport['promoCodes'][number];
  const columns: Column<P>[] = [
    { key: 'opens', label: m.figures.opens, cell: (x) => (x.opens === null ? '—' : num(x.opens)) },
    ...figureColumns<P>(r),
    { key: 'conversion', label: m.figures.conversion, cell: (x) => percent(x.conversion) },
  ];
  // its automatic link is «своя ссылка»; the owner's say where they are
  const where = (l: ReportLink) =>
    l.source === 'promo_code'
      ? m.promo.ownLink
      : `${sourceName[l.source]}: ${l.sourceLabel ?? l.code}`;
  return (
    <FiguresTable
      r={r}
      title={m.promo.title}
      nameLabel={m.promo.code}
      columns={columns}
      money={money}
      hint={m.promo.hint}
      empty={data.filters.code === NO_PROMO_CODE ? m.promo.noCodeChosen : m.promo.empty}
      lines={data.promoCodes.map((p) => ({
        key: String(p.promoCodeId),
        name: <span className={CODE}>{p.code}</span>,
        detail: p.links.length ? p.links.map(where).join(' · ') : m.promo.noLink,
        muted: quiet(p),
        data: p,
      }))}
    />
  );
}

/** What a Source row and its link rows share in both tables. */
type SourceLike<L> = MarketingFigures & { source: CampaignSource; links: L[] };

/**
 * Sources as rows: each with anything in the range, with its links under it (a lone link is named
 * on the Source's own row instead, its figures being the same), the quiet ones folded into one
 * line naming them.
 */
function sourceLines<S extends SourceLike<MarketingFigures & { link: ReportLink }>, X>(
  rows: S[],
  active: (s: S) => boolean,
  sourceName: Record<CampaignSource, string>,
  quietLabel: string,
  extra: (row: S | S['links'][number]) => X,
): Line<MarketingFigures & X>[] {
  const lines: Line<MarketingFigures & X>[] = [];
  for (const s of rows.filter(active)) {
    const only = s.links.length === 1 ? s.links[0] : undefined;
    const onlyDetail = only && linkDetail(only.link);
    lines.push({
      key: s.source,
      name: sourceName[s.source],
      detail: only ? (
        <>
          <LinkName link={only.link} />
          {onlyDetail && <> · {onlyDetail}</>}
        </>
      ) : undefined,
      data: { ...s, ...extra(s) },
    });
    if (!only)
      for (const l of s.links)
        lines.push({
          key: `${s.source}-${l.link.id}`,
          name: <LinkName link={l.link} />,
          detail: linkDetail(l.link),
          nested: true,
          data: { ...l, ...extra(l) },
        });
  }
  const folded = rows.filter((s) => !active(s)).map((s) => sourceName[s.source]);
  if (folded.length) lines.push({ key: 'quiet', folded, label: quietLabel });
  return lines;
}

/** Sources by the order's campaign link, then «Без ссылки». */
function Sources({ r, data, money, sourceName }: SectionProps) {
  const m = r.marketing;
  type S = MarketingFigures & { opens: number | null; conversion: number | null };
  const columns: Column<S>[] = [
    { key: 'opens', label: m.figures.opens, cell: (x) => (x.opens === null ? '—' : num(x.opens)) },
    ...figureColumns<S>(r),
    { key: 'conversion', label: m.figures.conversion, cell: (x) => percent(x.conversion) },
  ];
  const lines = sourceLines(
    data.sources,
    (s) => !quiet(s) || s.opens > 0,
    sourceName,
    m.sources.quiet,
    (x): Omit<S, keyof MarketingFigures> => ({ opens: x.opens, conversion: x.conversion }),
  );
  // orders without a link are their own row, unless the Source filter names a Source
  if (!data.filters.source || data.filters.source === NO_SOURCE)
    lines.push({
      key: 'without',
      name: m.sources.withoutLink,
      muted: quiet(data.withoutLink),
      data: { ...data.withoutLink, opens: null, conversion: null },
    });
  return (
    <FiguresTable
      r={r}
      title={m.sources.title}
      nameLabel={m.sources.source}
      columns={columns}
      money={money}
      hint={m.sources.hint}
      lines={lines}
    />
  );
}

/** Acquisition by the customer's first link, then «Без первой ссылки». */
function Acquisition({ r, data, money, sourceName }: SectionProps) {
  const m = r.marketing;
  type A = MarketingFigures & { acquired: number | null };
  const columns: Column<A>[] = [
    {
      key: 'acquired',
      label: m.figures.acquired,
      cell: (x) => (x.acquired === null ? '—' : num(x.acquired)),
    },
    ...figureColumns<A>(r),
  ];
  const lines = sourceLines(
    data.acquisition,
    (a) => !quiet(a) || a.acquired > 0,
    sourceName,
    m.sources.quiet,
    (x): Omit<A, keyof MarketingFigures> => ({ acquired: x.acquired }),
  );
  for (const [key, name, figures] of [
    ['earlier', m.acquisition.earlierCustomers, data.earlierCustomers],
    ['without', m.acquisition.withoutFirstLink, data.withoutFirstLink],
  ] as const)
    lines.push({ key, name, muted: quiet(figures), data: { ...figures, acquired: null } });
  return (
    <FiguresTable
      r={r}
      title={m.acquisition.title}
      nameLabel={m.sources.source}
      columns={columns}
      money={money}
      hint={m.acquisition.hint}
      lines={lines}
    />
  );
}

/** The set discount: rights issued and used, and the orders that used them, per what opened them. */
function Rights({ r, data, money }: Omit<SectionProps, 'sourceName'>) {
  const m = r.marketing;
  type U = MarketingReport['upgradeRights'][number];
  const f = m.figures;
  const columns: Column<U>[] = [
    { key: 'issued', label: f.issued, cell: (x) => num(x.issued) },
    { key: 'used', label: f.used, cell: (x) => num(x.orders) },
    customersColumn<U>(r),
    ...moneyColumns<U>(r),
  ];
  return (
    <FiguresTable
      r={r}
      title={m.rights.title}
      nameLabel={m.rights.kind}
      columns={columns}
      money={money}
      hint={m.rights.hint}
      lines={data.upgradeRights.map((u) => ({
        key: u.source,
        name: m.rights.sources[u.source],
        muted: quiet(u) && u.issued === 0,
        data: u,
      }))}
    />
  );
}
