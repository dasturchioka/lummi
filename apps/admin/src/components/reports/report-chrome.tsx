import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import type { AdminMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Copy = AdminMessages['reports'];

/** The reports, each its own page: the sales report (#42) and the marketing reports (#43). */
export const REPORT_PAGES = { sales: '/reports', marketing: '/reports/marketing' } as const;
export type ReportPage = keyof typeof REPORT_PAGES;

/**
 * «Продажи · Маркетинг»: links, so each report keeps its own URL; the asked range goes along, so
 * switching compares the same days.
 */
export function ReportTabs({
  r,
  current,
  asked,
}: {
  r: Copy;
  current: ReportPage;
  /** The range the URL asked for, empty for the default one. */
  asked: { from?: string; to?: string };
}) {
  const query = new URLSearchParams(
    Object.entries(asked).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return (
    <nav
      aria-label={r.tabs.label}
      className="mb-4 inline-flex h-9 items-center rounded-full bg-field p-[3px]"
    >
      {(Object.keys(REPORT_PAGES) as ReportPage[]).map((page) => (
        <Link
          key={page}
          href={query ? `${REPORT_PAGES[page]}?${query}` : REPORT_PAGES[page]}
          aria-current={page === current ? 'page' : undefined}
          className={cn(
            'grid h-full place-items-center rounded-full px-4 text-[13px] whitespace-nowrap transition-[color,background-color] duration-150 ease-out',
            page === current
              ? 'bg-card font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          {r.tabs[page]}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The range of a report: a GET form, so a view survives a reload and the Excel export takes the
 * same range. «Последние 30 дней» shows while a range was asked (it keeps the other choices); a
 * refused one is said above the default range's figures. A report's own filters (`fields`) sit
 * after the dates in the same form.
 */
export function ReportRange({
  r,
  page,
  range,
  asked,
  invalid,
  keep,
  fields,
  resetKeep,
  note,
}: {
  r: Copy;
  page: ReportPage;
  /** The range the figures cover. */
  range: { from: string; to: string };
  asked: { from?: string; to?: string };
  invalid: boolean;
  /** Other view choices the URL carries as hidden fields (the sales report's `top`). */
  keep?: Record<string, string>;
  /** The report's own filter fields, in the form after the dates; kept by the reset too. */
  fields?: ReactNode;
  /** What «Последние 30 дней» keeps besides `keep` (the filters in use). */
  resetKeep?: Record<string, string>;
  /** A line under the form while a filter is in use. */
  note?: ReactNode;
}) {
  const custom = Boolean(asked.from || asked.to);
  const kept = { ...keep, ...resetKeep };
  const reset = Object.keys(kept).length
    ? `${REPORT_PAGES[page]}?${new URLSearchParams(kept)}`
    : REPORT_PAGES[page];
  return (
    <Card className="mb-4 p-4 lg:p-5">
      <form
        method="get"
        action={REPORT_PAGES[page]}
        className={cn(
          'grid grid-cols-2 gap-3',
          fields
            ? 'lg:grid-cols-[repeat(4,minmax(0,12rem))_auto] lg:items-end'
            : 'sm:grid-cols-[repeat(2,minmax(0,12rem))_auto] sm:items-end',
        )}
      >
        <Field id="r-from" label={r.from}>
          <Input type="date" name="from" defaultValue={range.from} required />
        </Field>
        <Field id="r-to" label={r.to}>
          <Input type="date" name="to" defaultValue={range.to} required />
        </Field>
        {fields}
        {Object.entries(keep ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div
          className={cn(
            'col-span-2 flex flex-wrap gap-2',
            fields ? 'lg:col-span-1' : 'sm:col-span-1',
          )}
        >
          <Button type="submit" className="max-sm:flex-1">
            {r.apply}
          </Button>
          {custom && !invalid && (
            <Button asChild variant="outline" className="max-sm:flex-1">
              <Link href={reset}>{r.reset}</Link>
            </Button>
          )}
        </div>
      </form>
      {note && <p className="mt-3 text-small text-muted-foreground">{note}</p>}
      {invalid && <Notice title={r.invalidRange} className="mt-3" />}
    </Card>
  );
}
