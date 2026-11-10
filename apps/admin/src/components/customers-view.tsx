import type { AdminCustomer, AdminCustomersPage, CustomersQuery } from '@lummi/contracts';
import { formatMoney, formatPhone, plural, type Language } from '@lummi/i18n';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MetaLine } from '@/components/ui/meta-line';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { telegramLink } from '@/lib/telegram-link';
import { TEXT_LINK } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

export type CustomerFilters = Pick<CustomersQuery, 'q' | 'sort'>;

/** «@username» when there is one, otherwise the plain "open in Telegram" label; never the numeric id. */
export function TelegramLink({ c, t }: { c: AdminCustomer; t: AdminMessages }) {
  return (
    <a
      href={telegramLink(c)}
      target="_blank"
      rel="noreferrer"
      className={cn(TEXT_LINK, 'inline-flex items-center gap-1.5 break-all')}
    >
      <Send className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
      {c.username ? (
        `@${c.username}`
      ) : (
        <span className="whitespace-nowrap">{t.customers.openTelegram}</span>
      )}
    </a>
  );
}

export function BlockedBadge({ t }: { t: AdminMessages }) {
  return (
    <Badge tone="neutral" title={t.customers.blockedHint}>
      {t.customers.blocked}
    </Badge>
  );
}

/** The customers list: a GET form (search and sort), the table and numbered pages. */
export function CustomersView({
  t,
  language,
  data,
  filters,
}: {
  t: AdminMessages;
  language: Language;
  data: AdminCustomersPage;
  filters: CustomerFilters;
}) {
  const c = t.customers;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = Boolean(filters.q);
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (filters.q) q.set('q', filters.q);
    if (filters.sort && filters.sort !== 'newest') q.set('sort', filters.sort);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `/customers?${s}` : '/customers';
  };
  const pageText = fill(c.page, { page: num(data.page), pages: num(pages) });
  return (
    <>
      <PageHeader title={c.title} description={c.description} />
      <Card className="mb-4 p-4 lg:p-5">
        <form
          method="get"
          action="/customers"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end"
        >
          <Field id="f-q" label={c.search}>
            <Input
              type="search"
              name="q"
              defaultValue={filters.q ?? ''}
              placeholder={c.searchPlaceholder}
              autoComplete="off"
              maxLength={100}
            />
          </Field>
          <Field id="f-sort" label={c.sort}>
            <Select name="sort" defaultValue={filters.sort ?? 'newest'}>
              <option value="newest">{c.sortNewest}</option>
              <option value="spent">{c.sortSpent}</option>
              <option value="orders">{c.sortOrders}</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" className="max-sm:flex-1">
              {c.apply}
            </Button>
            {(filtered || (filters.sort && filters.sort !== 'newest')) && (
              <Button asChild variant="outline" className="max-sm:flex-1">
                <Link href="/customers">{c.reset}</Link>
              </Button>
            )}
          </div>
        </form>
      </Card>

      {data.items.length === 0 ? (
        <EmptyState
          title={filtered ? c.emptyFiltered : c.empty}
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href="/customers">{c.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {filtered ? c.emptyFilteredText : c.emptyText}
        </EmptyState>
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {plural(language, data.total, c.total)}
          </p>
          {/* phones: one block per customer, orders and total spent in view without side scroll */}
          <ul className="divide-y divide-border sm:hidden">
            {data.items.map((row) => (
              <li
                key={row.id}
                data-testid={`customer-block-${row.id}`}
                className="grid gap-1 px-4 py-3.5"
              >
                <Link
                  href={`/customers/${row.id}`}
                  className="font-semibold leading-snug [overflow-wrap:anywhere] underline-offset-[3px] hover:underline"
                >
                  {row.name}
                </Link>
                <p className="text-small tabular-nums">
                  {c.orders}: <span className="font-semibold">{num(row.ordersCount)}</span> ·{' '}
                  {c.spent}{' '}
                  <span className="font-semibold">{formatMoney(row.totalSpent, language)}</span>
                </p>
                {row.botBlocked && (
                  <span>
                    <BlockedBadge t={t} />
                  </span>
                )}
                <MetaLine
                  className="text-small text-muted-foreground [overflow-wrap:anywhere]"
                  parts={[
                    <TelegramLink key="tg" c={row} t={t} />,
                    row.phone ? formatPhone(row.phone) : c.noPhone,
                    row.language.toUpperCase(),
                  ]}
                />
              </li>
            ))}
          </ul>
          <div className="hidden sm:block">
            <Table>
              <THead>
                <TR>
                  <TH>{c.name}</TH>
                  <TH>{c.telegram}</TH>
                  <TH>{c.phone}</TH>
                  <TH>{c.language}</TH>
                  <TH className="text-right" title={c.ordersHint}>
                    {c.orders}
                  </TH>
                  <TH className="text-right" title={c.spentHint}>
                    {c.spent}
                  </TH>
                  <TH>{c.blocked}</TH>
                </TR>
              </THead>
              <TBody>
                {data.items.map((row) => (
                  <TR key={row.id} data-testid={`customer-row-${row.id}`}>
                    <TD className="min-w-[13rem] max-w-[20rem]">
                      <Link
                        href={`/customers/${row.id}`}
                        className="font-semibold break-words hover:underline underline-offset-[3px]"
                      >
                        {row.name}
                      </Link>
                    </TD>
                    <TD className="min-w-[11rem] max-w-[16rem]">
                      <TelegramLink c={row} t={t} />
                    </TD>
                    <TD className="whitespace-nowrap">
                      {row.phone ? (
                        formatPhone(row.phone)
                      ) : (
                        <span className="text-muted-foreground">{c.noPhone}</span>
                      )}
                    </TD>
                    <TD className="uppercase">{row.language}</TD>
                    <TD className="text-right">{num(row.ordersCount)}</TD>
                    <TD className="text-right font-semibold whitespace-nowrap">
                      {formatMoney(row.totalSpent, language)}
                    </TD>
                    <TD>{row.botBlocked ? <BlockedBadge t={t} /> : null}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      {pages > 1 && (
        <nav
          aria-label={pageText}
          className="mt-4 flex items-center justify-between gap-3 text-small text-muted-foreground"
        >
          <PageLink href={data.page > 1 ? href(data.page - 1) : null}>
            <ChevronLeft strokeWidth={1.5} aria-hidden />
            {c.prev}
          </PageLink>
          <span className="text-center tabular-nums">{pageText}</span>
          <PageLink href={data.page < pages ? href(data.page + 1) : null}>
            {c.next}
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
