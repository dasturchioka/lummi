import type { StockList, StockQuery } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StockTable } from '@/components/stock-table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';

/**
 * The stock page: a GET form (the URL is the state, so a filtered view can be linked, as on the
 * audit page) over the editable table.
 */
export function StockView({
  t,
  language,
  data,
  query,
}: {
  t: AdminMessages;
  language: Language;
  data: StockList;
  query: StockQuery;
}) {
  const s = t.stock;
  const filtered = Boolean(query.q || query.filter || query.visibility);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const key of ['q', 'filter', 'visibility'] as const)
      if (query[key]) q.set(key, query[key]);
    if (p > 1) q.set('page', String(p));
    const text = q.toString();
    return text ? `/stock?${text}` : '/stock';
  };
  const pageText = fill(s.page, { page: num(data.page), pages: num(pages) });
  return (
    <>
      <PageHeader
        title={s.title}
        description={s.description}
        actions={
          <Button asChild variant="outline">
            <a href={`/api/admin/warehouse/export?lang=${language}`} download>
              <Download strokeWidth={1.5} aria-hidden />
              {s.exportExcel}
            </a>
          </Button>
        }
      />
      <Card className="mb-4 p-4 lg:p-5">
        <form
          method="get"
          action="/stock"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          <Field id="f-q" label={s.search}>
            <Input
              type="search"
              name="q"
              defaultValue={query.q ?? ''}
              placeholder={s.searchPlaceholder}
              autoComplete="off"
              maxLength={100}
            />
          </Field>
          <Field id="f-filter" label={s.show}>
            <Select name="filter" defaultValue={query.filter ?? ''}>
              <option value="">{s.showAll}</option>
              <option value="low">{s.showLow}</option>
              <option value="zero">{s.showZero}</option>
              <option value="oilLow">{s.showOilLow}</option>
            </Select>
          </Field>
          <Field id="f-visibility" label={s.fragrances}>
            <Select name="visibility" defaultValue={query.visibility ?? ''}>
              <option value="">{s.fragrancesAll}</option>
              <option value="visible">{s.fragrancesVisible}</option>
              <option value="hidden">{s.fragrancesHidden}</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" className="max-sm:flex-1">
              {s.apply}
            </Button>
            {filtered && (
              <Button asChild variant="outline" className="max-sm:flex-1">
                <Link href="/stock">{s.reset}</Link>
              </Button>
            )}
          </div>
        </form>
      </Card>
      {data.rows.length === 0 ? (
        <EmptyState
          title={s.empty}
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href="/stock">{s.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {s.emptyText}
        </EmptyState>
      ) : (
        <StockTable
          rows={data.rows}
          oil={data.oil}
          lowThreshold={data.lowThreshold}
          lowOilLitres={data.lowOilLitres}
          total={data.total}
          language={language}
          t={t}
        />
      )}
      {pages > 1 && (
        <nav
          aria-label={pageText}
          className="mt-4 flex items-center justify-between gap-3 text-small text-muted-foreground"
        >
          <PageLink href={data.page > 1 ? href(data.page - 1) : null}>
            <ChevronLeft strokeWidth={1.5} aria-hidden />
            {s.prev}
          </PageLink>
          <span className="text-center tabular-nums">{pageText}</span>
          <PageLink href={data.page < pages ? href(data.page + 1) : null}>
            {s.next}
            <ChevronRight strokeWidth={1.5} aria-hidden />
          </PageLink>
        </nav>
      )}
    </>
  );
}

function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  ) : (
    <Button variant="outline" size="sm" disabled>
      {children}
    </Button>
  );
}
