import type {
  FragranceSales,
  SalesDay,
  SalesFigures,
  SalesReport,
  VolumeSales,
} from '@lummi/contracts';
import { formatCalendarDate, formatMoney, plural, type Language } from '@lummi/i18n';
import {
  BanknoteArrowUp,
  Download,
  ReceiptText,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { StatAmount, StatCard, StatGrid } from '@/components/ui/stat-card';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { cn, fill } from '@/lib/utils';
import { HowCounted, ReportRange, ReportTabs } from './report-chrome';

/** How the top lists rank: most units (the API's order) or most net. */
export type TopOrder = 'units' | 'net';
/** Rows each top list shows; the Excel export has them all. */
const TOP_ROWS = 10;

const HEADING = 'font-display text-[13px] leading-[1.35] tracking-[0.2em] uppercase';

type Copy = AdminMessages['reports'];

/**
 * The owner's sales report (#42): the report tabs, the range (`ReportRange`), the range's
 * figures, every day newest first, then the top fragrances, Volumes and sets. It only lays out
 * what the API computed (`salesSummary`).
 */
export function SalesReportView({
  t,
  language,
  data,
  asked,
  top,
  invalid,
}: {
  t: AdminMessages;
  language: Language;
  data: SalesReport;
  /** The range the URL asked for, empty for the default one. */
  asked: { from?: string; to?: string };
  top: TopOrder;
  /** The asked range was refused; `data` is the default range. */
  invalid: boolean;
}) {
  const r = t.reports;
  const money = (n: number) => formatMoney(n, language);
  const exportHref = `/api/admin/reports/sales/export?${new URLSearchParams({
    from: data.from,
    to: data.to,
    lang: language,
  })}`;
  const sold = data.totals.orders > 0 || data.totals.refunds > 0;

  return (
    <>
      <PageHeader
        title={r.title}
        description={r.description}
        actions={
          <Button asChild variant="outline">
            <a href={exportHref} download>
              <Download strokeWidth={1.5} aria-hidden />
              {r.export}
            </a>
          </Button>
        }
      />

      <ReportTabs r={r} current="sales" asked={asked} />
      <ReportRange
        r={r}
        page="sales"
        range={data}
        asked={asked}
        invalid={invalid}
        keep={top === 'net' ? { top: 'net' } : undefined}
      />

      {!sold ? (
        <EmptyState title={r.empty}>{r.emptyText}</EmptyState>
      ) : (
        <div className="grid gap-4 lg:gap-6">
          <Totals r={r} totals={data.totals} money={money} />
          <Days r={r} language={language} data={data} money={money} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={HEADING}>{r.topTitle}</h2>
            <TopSwitch r={r} data={data} top={top} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
            <TopList
              title={r.fragrances}
              r={r}
              language={language}
              rows={sortTop(data.fragrances, top)}
              by={top}
              name={(row) => row.name[language]}
              money={money}
            />
            <TopList
              title={r.volumes}
              r={r}
              language={language}
              rows={sortTop(data.volumes, top)}
              by={top}
              name={(row: VolumeSales) =>
                `${row.name[language]}, ${fill(r.ml, { ml: String(row.ml) })}`
              }
              money={money}
            />
          </div>
          <HowCounted r={r} className="-mt-2 px-1 lg:-mt-4">
            <p>{r.linesHint}</p>
          </HowCounted>
          <Card className="p-4 sm:p-5">
            <h2 className={HEADING}>{r.sets}</h2>
            <ul className="mt-3 divide-y divide-border">
              {data.sets.map((s) => (
                <li
                  key={s.kind}
                  className={cn(
                    'flex items-baseline justify-between gap-3 py-2.5',
                    s.units === 0 && 'text-muted-foreground',
                  )}
                >
                  <span className="min-w-0 font-semibold">{r.setKinds[s.kind]}</span>
                  <span className="text-right tabular-nums">
                    <span className="mr-3 text-small text-muted-foreground">
                      {fill(r.unitsCount, { n: num(s.units) })}
                    </span>
                    <span className="font-semibold whitespace-nowrap">{money(s.net)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-small text-muted-foreground">{r.setsHint}</p>
          </Card>
        </div>
      )}
    </>
  );
}

/**
 * The range at a glance: net, orders, average check, refunds as figure cards; the parts of net and
 * how they add up in a muted line under them.
 */
function Totals({
  r,
  totals,
  money,
}: {
  r: Copy;
  totals: SalesFigures;
  money: (n: number) => string;
}) {
  const f = r.figures;
  const cards: { key: string; icon: LucideIcon; label: string; value: string }[] = [
    { key: 'net', icon: Wallet, label: f.net, value: money(totals.net) },
    { key: 'orders', icon: ShoppingBag, label: f.orders, value: num(totals.orders) },
    {
      key: 'average',
      icon: ReceiptText,
      label: f.averageCheck,
      value: totals.averageCheck === null ? '—' : money(totals.averageCheck),
    },
    { key: 'refunds', icon: BanknoteArrowUp, label: f.refunds, value: money(totals.refunds) },
  ];
  return (
    <section aria-label={r.total} className="@container">
      <StatGrid>
        {cards.map((c) => (
          <StatCard
            key={c.key}
            icon={c.icon}
            label={c.label}
            value={<StatAmount text={c.value} />}
          />
        ))}
      </StatGrid>
      <dl className="mt-3 flex flex-col gap-1 px-1 text-small sm:flex-row sm:flex-wrap sm:gap-x-6">
        {(
          [
            [f.itemsBeforeDiscount, totals.itemsBeforeDiscount],
            [f.discount, totals.discount],
            [f.delivery, totals.delivery],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 sm:justify-start">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium whitespace-nowrap tabular-nums">{money(value)}</dd>
          </div>
        ))}
      </dl>
      <HowCounted r={r} className="px-1">
        <p>{r.periodHint}</p>
        <p>{r.netHint}</p>
      </HowCounted>
    </section>
  );
}

/** `14 ноября, пт` / `14-noyabr, Ju`. */
function dayLabel(r: Copy, day: string, language: Language) {
  const weekday = r.weekdays[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return `${formatCalendarDate(day, language)}, ${weekday}`;
}

const quiet = (d: SalesFigures) => d.orders === 0 && d.refunds === 0;

/** A day with sales, or a run of days without (newest first, so `to` comes before `from`). */
type DayRow = { day: SalesDay } | { from: string; to: string };

/** The days newest first, each run of two or more quiet days folded into one row. */
function dayRows(days: SalesDay[]): DayRow[] {
  const rows: DayRow[] = [];
  for (const d of [...days].reverse()) {
    const last = rows.at(-1);
    if (!quiet(d)) rows.push({ day: d });
    else if (last && 'from' in last) last.from = d.day;
    else rows.push({ from: d.day, to: d.day });
  }
  return rows;
}

/** A quiet row's label: the day as the day rows read, or «16 октября – 4 ноября», unbroken dates. */
function QuietLabel({ r, row, language }: { r: Copy; row: DayRow; language: Language }) {
  if ('day' in row) return null;
  if (row.from === row.to) return <>{dayLabel(r, row.from, language)}</>;
  return (
    <>
      <span className="whitespace-nowrap">{formatCalendarDate(row.from, language)}</span> –{' '}
      <span className="whitespace-nowrap">{formatCalendarDate(row.to, language)}</span>
    </>
  );
}

/** The day table's columns after the day, in order. */
const COLUMNS = [
  'orders',
  'itemsBeforeDiscount',
  'discount',
  'delivery',
  'refunds',
  'net',
  'averageCheck',
] as const satisfies readonly (keyof SalesFigures)[];
type Column = (typeof COLUMNS)[number];

/**
 * Every day of the range, newest first: a table on wide screens, one block per day on phones. A run
 * of two or more days without sales is one muted row (the Excel keeps every day).
 */
function Days({
  r,
  language,
  data,
  money,
}: {
  r: Copy;
  language: Language;
  data: SalesReport;
  money: (n: number) => string;
}) {
  const f = r.figures;
  const rows = dayRows(data.days);
  // a dense money table: bare tabular numbers, the caption above names the currency (DESIGN.md,
  // admin notes); seven columns with «сум» in every cell would be noise
  const cell = (d: SalesFigures, key: Column) =>
    key === 'averageCheck' ? (d.averageCheck === null ? '—' : num(d.averageCheck)) : num(d[key]);
  const th = 'h-auto py-2 align-bottom leading-tight whitespace-normal px-3';
  const td = 'px-3 text-right whitespace-nowrap';
  return (
    <Card className="@container">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-1 @2xl:px-5 @2xl:pt-5">
        <h2 className={HEADING}>{r.byDay}</h2>
        <p className="hidden text-small text-muted-foreground @2xl:block">{r.inSom}</p>
      </div>
      {/* narrow: one block per day with sales, net first; a quiet run is one muted line */}
      <ul className="divide-y divide-border @2xl:hidden">
        {rows.map((row) =>
          'day' in row ? (
            <DayBlock
              key={row.day.day}
              r={r}
              d={row.day}
              label={dayLabel(r, row.day.day, language)}
              money={money}
            />
          ) : (
            <li
              key={row.to}
              className="flex justify-between gap-3 px-4 py-2 text-xs text-muted-foreground/80"
            >
              <span>
                <QuietLabel r={r} row={row} language={language} />
              </span>
              <span className="shrink-0">{r.noSales}</span>
            </li>
          ),
        )}
        <DayBlock r={r} d={data.totals} label={r.total} money={money} total />
      </ul>
      <div className="hidden @2xl:block">
        <Table className="text-[13px]">
          <THead>
            <TR>
              <TH className={th}>{r.day}</TH>
              {COLUMNS.map((key) => (
                <TH key={key} className={cn(th, 'text-right')}>
                  {f[key]}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((row) =>
              'day' in row ? (
                <TR key={row.day.day} data-testid={`day-${row.day.day}`}>
                  <TD className="px-3 whitespace-nowrap">{dayLabel(r, row.day.day, language)}</TD>
                  {COLUMNS.map((key) => (
                    <TD key={key} className={cn(td, key === 'net' && 'font-semibold')}>
                      {cell(row.day, key)}
                    </TD>
                  ))}
                </TR>
              ) : (
                <TR
                  key={row.to}
                  data-testid={`quiet-${row.from}`}
                  className="text-xs text-muted-foreground/80"
                >
                  <TD className="px-3">
                    <QuietLabel r={r} row={row} language={language} />
                  </TD>
                  <TD colSpan={COLUMNS.length} className="px-3">
                    {r.noSales}
                  </TD>
                </TR>
              ),
            )}
          </TBody>
          <tfoot>
            <tr className="border-t border-border-strong font-semibold">
              <TD className="px-3">{r.total}</TD>
              {COLUMNS.map((key) => (
                <TD key={key} className={td}>
                  {cell(data.totals, key)}
                </TD>
              ))}
            </tr>
          </tfoot>
        </Table>
      </div>
    </Card>
  );
}

function DayBlock({
  r,
  d,
  label,
  money,
  total,
}: {
  r: Copy;
  d: SalesFigures;
  label: string;
  money: (n: number) => string;
  total?: boolean;
}) {
  const f = r.figures;
  const part = (name: string, value: string) => (
    <span key={name} className="whitespace-nowrap">
      {name} <span className="text-foreground tabular-nums">{value}</span>
    </span>
  );
  return (
    <li className={cn('grid gap-1 px-4 py-3.5', total && 'bg-milk/60')}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <span className="text-right">
          <span className="sr-only">{f.net}: </span>
          <span className="font-semibold whitespace-nowrap tabular-nums">{money(d.net)}</span>
        </span>
      </div>
      <MetaLine
        className="text-small text-muted-foreground"
        parts={[
          part(f.orders, num(d.orders)),
          part(f.averageCheck, d.averageCheck === null ? '—' : money(d.averageCheck)),
        ]}
      />
      <MetaLine
        className="text-small text-muted-foreground"
        parts={[
          part(f.itemsBeforeDiscount, money(d.itemsBeforeDiscount)),
          part(f.discount, money(d.discount)),
          part(f.delivery, money(d.delivery)),
          part(f.refunds, money(d.refunds)),
        ]}
      />
    </li>
  );
}

/** The top list in the chosen order: the API's (most units, then net), or most net, then units. */
function sortTop<R extends FragranceSales>(rows: R[], by: TopOrder): R[] {
  return by === 'units' ? rows : [...rows].sort((a, b) => b.net - a.net || b.units - a.units);
}

/** «По штукам · По сумме»: links, so the choice lives in the URL with the range. */
function TopSwitch({ r, data, top }: { r: Copy; data: SalesReport; top: TopOrder }) {
  const href = (o: TopOrder) =>
    `/reports?${new URLSearchParams({
      from: data.from,
      to: data.to,
      ...(o === 'net' ? { top: 'net' } : {}),
    })}`;
  return (
    <div
      role="group"
      aria-label={r.sort}
      className="inline-flex h-9 shrink-0 items-center rounded-full bg-field p-[3px]"
    >
      {(
        [
          ['units', r.byUnits],
          ['net', r.byNet],
        ] as const
      ).map(([o, label]) => (
        <Link
          key={o}
          href={href(o)}
          scroll={false}
          aria-current={top === o ? 'true' : undefined}
          className={cn(
            'grid h-full place-items-center rounded-full px-3 text-[13px] whitespace-nowrap transition-[color,background-color] duration-150 ease-out',
            top === o
              ? 'bg-card font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

function TopList<R extends FragranceSales>({
  title,
  r,
  language,
  rows,
  by,
  name,
  money,
}: {
  title: string;
  r: Copy;
  language: Language;
  rows: R[];
  /** The figure the list is sorted by leads, in weight; the other follows, muted. */
  by: TopOrder;
  name: (row: R) => string;
  money: (n: number) => string;
}) {
  const shown = rows.slice(0, TOP_ROWS);
  const more = rows.length - shown.length;
  return (
    <Card className="p-4 sm:p-5">
      <h3 className={HEADING}>{title}</h3>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{r.noneSold}</p>
      ) : (
        <ol className="mt-2 divide-y divide-border">
          {shown.map((row, i) => (
            <li
              key={'volumeId' in row ? `v${row.volumeId}` : `f${row.fragranceId}`}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-baseline gap-x-2 py-2.5"
            >
              <span className="text-small text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="min-w-0">
                <span className="block font-semibold break-words">{name(row)}</span>
                {row.brand && (
                  <span className="block text-small break-words text-muted-foreground">
                    {fill(r.attribution, { brand: row.brand })}
                  </span>
                )}
              </span>
              <span className="text-right tabular-nums">
                {(by === 'net'
                  ? [money(row.net), fill(r.unitsCount, { n: num(row.units) })]
                  : [fill(r.unitsCount, { n: num(row.units) }), money(row.net)]
                ).map((text, k) => (
                  <span
                    key={k}
                    className={cn(
                      'block whitespace-nowrap',
                      k === 0 ? 'font-semibold' : 'text-small text-muted-foreground',
                    )}
                  >
                    {text}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
      {more > 0 && (
        <p className="mt-2 text-small text-muted-foreground">{plural(language, more, r.more)}</p>
      )}
    </Card>
  );
}
