'use client';

import { CREDIT_LINK_FILTERS, type AdminCreditDto } from '@lummi/contracts';
import { formatTiyin, plural, type Language } from '@lummi/i18n';
import { SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MetaLine } from '@/components/ui/meta-line';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent, num } from '@/lib/setting-copy';
import { TEXT_LINK } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

export type CreditFilters = { linked?: string; amount?: string; from?: string; to?: string };

type Props = {
  t: AdminMessages;
  language: Language;
  items: AdminCreditDto[];
  total: number;
  page: number;
  pageSize: number;
  filters: CreditFilters;
};

/**
 * «Поступления» (#33): every Humo credit, newest first, with the order it paid or «Не
 * привязано». The amount is exact to the tiyin; a credit with tiyin, or one to another card, says
 * why it can never pay an order on its own.
 */
export function CreditsList({ t, language, items, total, page, pageSize, filters }: Props) {
  const c = t.credits;
  const f = c.filters;
  const active = [filters.linked, filters.amount, filters.from, filters.to].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  const hidden = !open && 'max-sm:hidden';
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `/credits?${s}` : '/credits';
  };

  const amount = (it: AdminCreditDto) => (
    <span className="font-semibold whitespace-nowrap tabular-nums">
      {formatTiyin(it.amountTiyin, language)}
    </span>
  );
  /** Why this credit cannot pay an order by itself, if it cannot. */
  const caveat = (it: AdminCreditDto) =>
    [!it.onShopCard && c.otherCard, it.amountSom === null && c.withTiyin].filter((x): x is string =>
      Boolean(x),
    );
  const link = (it: AdminCreditDto) =>
    it.order ? (
      <Link href={`/orders/${it.order.number}`} className={cn(TEXT_LINK, 'whitespace-nowrap')}>
        {fill(c.order, { number: String(it.order.number) })}
      </Link>
    ) : (
      <Badge>{c.unlinked}</Badge>
    );

  return (
    <>
      <PageHeader
        title={c.title}
        description={c.description}
        actions={
          <Link href="/orders" className={TEXT_LINK}>
            {c.toOrders}
          </Link>
        }
      />

      <Card className="mb-4 p-4 lg:p-5">
        <form
          method="get"
          action="/credits"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end"
        >
          <div className="flex gap-2 sm:hidden">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              aria-expanded={open}
              aria-controls="c-linked c-amount c-from c-to"
              onClick={() => setOpen((v) => !v)}
            >
              <SlidersHorizontal strokeWidth={1.5} aria-hidden />
              {f.toggle}
              {active > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                  {active}
                </span>
              )}
            </Button>
            {active > 0 && (
              <Button asChild variant="outline" className="flex-1">
                <Link href="/credits">{f.reset}</Link>
              </Button>
            )}
          </div>
          <Field id="c-linked" label={f.linked} className={cn(hidden)}>
            <Select name="linked" defaultValue={filters.linked ?? 'all'}>
              {CREDIT_LINK_FILTERS.map((l) => (
                <option key={l} value={l}>
                  {c.link[l]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="c-amount" label={f.amount} className={cn(hidden)}>
            <Input
              name="amount"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={filters.amount ?? ''}
              placeholder="149 000"
            />
          </Field>
          <Field id="c-from" label={f.from} className={cn(hidden)}>
            <Input type="date" name="from" defaultValue={filters.from ?? ''} />
          </Field>
          <Field id="c-to" label={f.to} className={cn(hidden)}>
            <Input type="date" name="to" defaultValue={filters.to ?? ''} />
          </Field>
          <div className={cn('flex gap-2 sm:col-span-2 lg:col-span-1 lg:justify-end', hidden)}>
            <Button type="submit" className="max-sm:flex-1">
              {f.apply}
            </Button>
            {active > 0 && (
              <Button asChild variant="outline" className="max-sm:hidden">
                <Link href="/credits">{f.reset}</Link>
              </Button>
            )}
          </div>
        </form>
        {badRange && <Notice title={t.orders.badRange} className="mt-3" />}
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title={active > 0 ? c.emptyFiltered : c.empty}
          action={
            active > 0 ? (
              <Button asChild variant="outline">
                <Link href="/credits">{f.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {active > 0 ? c.emptyFilteredText : c.emptyText}
        </EmptyState>
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {fill(plural(language, total, c.total), { total: num(total) })}
          </p>
          <ul className="divide-y divide-border @3xl:hidden">
            {items.map((it) => (
              <li key={it.id} className="grid gap-1 px-4 py-4 @xl:px-5" data-credit={it.id}>
                <div className="flex items-baseline justify-between gap-3">
                  {amount(it)}
                  {link(it)}
                </div>
                <MetaLine
                  className="text-small text-muted-foreground tabular-nums"
                  parts={[
                    <time key="at" dateTime={it.occurredAt} className="whitespace-nowrap">
                      {formatTashkent(it.occurredAt)}
                    </time>,
                    <span key="card" className="whitespace-nowrap">
                      {it.cardMask}
                    </span>,
                    it.counterparty && (
                      <span key="from" className="[overflow-wrap:anywhere]">
                        {it.counterparty}
                      </span>
                    ),
                  ]}
                />
                {caveat(it).map((x) => (
                  <p key={x} className="text-small font-medium">
                    {x}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          <div className="hidden @3xl:block">
            <Table>
              <THead>
                <TR>
                  <TH className="w-px">{c.columns.when}</TH>
                  <TH className="w-px text-right">{c.columns.amount}</TH>
                  <TH>{c.columns.card}</TH>
                  <TH>{c.columns.source}</TH>
                  <TH className="w-px">{c.columns.order}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((it) => (
                  <TR key={it.id} className="[&>td]:py-3 [&>td]:align-top" data-credit={it.id}>
                    <TD className="whitespace-nowrap text-muted-foreground tabular-nums">
                      <time dateTime={it.occurredAt}>{formatTashkent(it.occurredAt)}</time>
                    </TD>
                    <TD className="text-right">
                      {amount(it)}
                      {it.amountSom === null && (
                        <span className="block text-small whitespace-nowrap text-muted-foreground">
                          {c.withTiyin}
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {it.cardMask}
                      {!it.onShopCard && (
                        <span className="block text-small text-muted-foreground">
                          {c.otherCard}
                        </span>
                      )}
                    </TD>
                    <TD className="min-w-[10rem] text-muted-foreground [overflow-wrap:anywhere]">
                      {it.counterparty}
                    </TD>
                    <TD>{link(it)}</TD>
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
          prev: t.orders.prev,
          next: t.orders.next,
          page: fill(t.orders.page, { page: num(page), pages: num(pages) }),
        }}
      />
    </>
  );
}
