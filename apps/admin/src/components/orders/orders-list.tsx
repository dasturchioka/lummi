import type { AdminOrderListItemDto } from '@lummi/contracts';
import { formatMoney, formatPhone, plural, type Language } from '@lummi/i18n';
import { Gift } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent, num } from '@/lib/setting-copy';
import { TEXT_LINK } from '@/lib/ui-classes';
import { listHref } from '@/lib/list-page';
import { fill } from '@/lib/utils';
import { PaymentBadge, paymentWorthShowing, RefundBadge, StatusBadge } from './badges';
import { OrdersFiltersForm, type OrderFilters } from './orders-filters';

export type { OrderFilters };

type Props = {
  t: AdminMessages;
  language: Language;
  items: AdminOrderListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  filters: OrderFilters;
};

/**
 * The orders list (#33): the filters (a GET form), the count, then the orders newest first, as
 * rows on phones and a table on wide screens. A row opens the order page; the number is the
 * keyboard path to it. Times are Asia/Tashkent; amounts come from the server.
 */
export function OrdersList({ t, language, items, total, page, pageSize, filters }: Props) {
  const o = t.orders;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Object.values(filters).some(Boolean);
  const href = (p: number) => listHref('/orders', filters, p);

  const number = (it: AdminOrderListItemDto) => (
    <Link
      href={`/orders/${it.number}`}
      className="rounded-sm font-semibold whitespace-nowrap tabular-nums underline-offset-[3px] after:absolute after:inset-0 hover:underline"
    >
      {fill(o.number, { number: String(it.number) })}
    </Link>
  );
  const lines = (it: AdminOrderListItemDto) => (
    <MetaLine
      parts={[
        <span key="first">
          <span className="font-medium text-foreground">{it.firstLine.name[language]}</span>{' '}
          <span className="whitespace-nowrap">
            {fill(o.lineQty, { ml: String(it.firstLine.ml), qty: String(it.firstLine.qty) })}
          </span>
        </span>,
        it.lineCount > 1 && fill(o.moreLines, { n: String(it.lineCount - 1) }),
        it.isGift && (
          <span key="gift" className="inline-flex items-center gap-1 whitespace-nowrap">
            <Gift className="size-3.5" strokeWidth={1.5} aria-hidden />
            {o.gift}
          </span>
        ),
      ]}
    />
  );
  const customer = (it: AdminOrderListItemDto) => (
    <>
      <span className="block font-medium break-words">{it.customer.name}</span>
      {it.customer.phone && (
        <span className="block text-small whitespace-nowrap text-muted-foreground tabular-nums">
          {formatPhone(it.customer.phone)}
        </span>
      )}
    </>
  );
  const money = (it: AdminOrderListItemDto) => (
    <span className="font-semibold whitespace-nowrap tabular-nums">
      {formatMoney(it.total, language)}
    </span>
  );

  return (
    <>
      <PageHeader
        title={o.title}
        description={o.description}
        actions={
          <Link href="/credits" className={TEXT_LINK}>
            {o.toCredits}
          </Link>
        }
      />

      <OrdersFiltersForm t={t} language={language} filters={filters} />

      {items.length === 0 ? (
        <EmptyState
          title={filtered ? o.emptyFiltered : o.empty}
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href="/orders">{o.filters.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {filtered ? o.emptyFilteredText : o.emptyText}
        </EmptyState>
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {fill(plural(language, total, o.total), { total: num(total) })}
          </p>
          <ul className="divide-y divide-border @4xl:hidden">
            {items.map((it) => (
              <li
                key={it.number}
                className="relative grid gap-1.5 px-4 py-4 transition-colors duration-150 hover:bg-milk/60 active:bg-milk @xl:px-5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  {number(it)}
                  {money(it)}
                </div>
                <MetaLine
                  className="text-small text-muted-foreground tabular-nums"
                  parts={[
                    <time key="at" dateTime={it.createdAt} className="whitespace-nowrap">
                      {formatTashkent(it.createdAt)}
                    </time>,
                    <span key="who" className="text-foreground">
                      {it.customer.name}
                    </span>,
                    it.customer.phone && (
                      <span key="phone" className="whitespace-nowrap">
                        {formatPhone(it.customer.phone)}
                      </span>
                    ),
                  ]}
                />
                <div className="text-small text-muted-foreground">{lines(it)}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <StatusBadge status={it.status} language={language} />
                  {paymentWorthShowing(it.status, it.payment) && (
                    <PaymentBadge payment={it.payment} t={t} />
                  )}
                  {it.refunded > 0 && (
                    <RefundBadge amount={it.refunded} t={t} language={language} />
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH className="w-px">{o.columns.order}</TH>
                  <TH>{o.columns.customer}</TH>
                  <TH>{o.columns.lines}</TH>
                  <TH className="w-px text-right">{o.columns.total}</TH>
                  <TH className="w-px">{o.columns.status}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((it) => (
                  <TR key={it.number} className="relative [&>td]:py-3 [&>td]:align-top">
                    <TD className="whitespace-nowrap">
                      {number(it)}
                      <time
                        dateTime={it.createdAt}
                        className="block text-small text-muted-foreground tabular-nums"
                      >
                        {formatTashkent(it.createdAt)}
                      </time>
                    </TD>
                    <TD className="min-w-[10rem]">{customer(it)}</TD>
                    <TD className="min-w-[13rem] text-small text-muted-foreground">{lines(it)}</TD>
                    <TD className="text-right">{money(it)}</TD>
                    <TD>
                      <div className="flex flex-col items-start gap-1.5">
                        <StatusBadge status={it.status} language={language} />
                        {paymentWorthShowing(it.status, it.payment) && (
                          <PaymentBadge payment={it.payment} t={t} />
                        )}
                        {it.refunded > 0 && (
                          <RefundBadge amount={it.refunded} t={t} language={language} />
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      <Pager
        page={page}
        pages={pages}
        href={href}
        labels={{
          prev: o.prev,
          next: o.next,
          page: fill(o.page, { page: num(page), pages: num(pages) }),
        }}
      />
    </>
  );
}
