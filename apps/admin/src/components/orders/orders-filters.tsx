'use client';

import { ORDER_PAYMENT_FILTERS, ORDER_STATUSES } from '@lummi/contracts';
import { formatCalendarDate, type Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import { SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import type { AdminMessages } from '@/lib/i18n';
import { listHref } from '@/lib/list-page';
import { cn, fill } from '@/lib/utils';

export type OrderFilters = {
  q?: string;
  status?: string;
  payment?: string;
  from?: string;
  to?: string;
  /** The Home's «Оплачено сегодня» cards: orders first paid that day. No field: a chip shows it. */
  paidOn?: string;
};

/**
 * A field that keeps to its grid cell: a long chosen status or placeholder gives way inside it
 * instead of running under the next field.
 */
const FIELD = 'min-w-0 grid-cols-[minmax(0,1fr)]';

/**
 * The orders list's filters (#33; the board has its own, #52): a plain GET form, so a filtered
 * view survives a reload and can be shared. From 1024 px two rows of four cells: the search (two
 * cells), the status and the payment state; the dates and the buttons.
 * The search (number or phone) is always in view; on phones the four selects open behind
 * «Фильтры» (open while any is set), as the catalog and the audit do.
 */
export function OrdersFiltersForm({
  t,
  language,
  filters,
}: {
  t: AdminMessages;
  language: Language;
  filters: OrderFilters;
}) {
  const f = t.orders.filters;
  const active = [filters.status, filters.payment, filters.from, filters.to].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  const any = active > 0 || Boolean(filters.q || filters.paidOn);
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const hidden = !open && 'max-sm:hidden';
  const statuses = ordersMessages[language].orders.status;

  return (
    <Card className="mb-4 p-4 lg:p-5">
      <form
        method="get"
        action="/orders"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
      >
        {/* the list sits behind «Список»; the board has its own filters (#52) */}
        <input type="hidden" name="view" value="list" />
        {filters.paidOn && <input type="hidden" name="paidOn" value={filters.paidOn} />}
        <Field id="f-q" label={f.search} className={cn(FIELD, 'sm:col-span-2')}>
          <Input
            name="q"
            type="search"
            inputMode="tel"
            enterKeyHint="search"
            autoComplete="off"
            defaultValue={filters.q ?? ''}
            placeholder={f.searchPlaceholder}
          />
        </Field>
        <div className="flex gap-2 sm:hidden">
          <Button type="submit" className="flex-1">
            {f.apply}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-expanded={open}
            aria-controls="f-status f-payment f-from f-to"
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
        </div>
        <Field id="f-status" label={f.status} className={cn(FIELD, hidden)}>
          <Select name="status" defaultValue={filters.status ?? ''}>
            <option value="">{f.all}</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statuses[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-payment" label={f.payment} className={cn(FIELD, hidden)}>
          <Select name="payment" defaultValue={filters.payment ?? ''}>
            <option value="">{f.all}</option>
            {ORDER_PAYMENT_FILTERS.map((p) => (
              <option key={p} value={p}>
                {t.orders.payment[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-from" label={f.from} className={cn(FIELD, hidden)}>
          <Input type="date" name="from" defaultValue={filters.from ?? ''} />
        </Field>
        <Field id="f-to" label={f.to} className={cn(FIELD, hidden)}>
          <Input type="date" name="to" defaultValue={filters.to ?? ''} />
        </Field>
        <div
          className={cn(
            'flex gap-2 sm:col-span-2 sm:justify-end',
            'max-sm:hidden',
            open && any && 'max-sm:flex',
          )}
        >
          <Button type="submit" className="max-sm:hidden">
            {f.apply}
          </Button>
          {any && (
            <Button asChild variant="outline" className="max-sm:flex-1">
              <Link href="/orders?view=list">{f.reset}</Link>
            </Button>
          )}
        </div>
      </form>
      {filters.paidOn && <PaidOnChip t={t} language={language} filters={filters} />}
      {badRange && <Notice title={t.orders.badRange} className="mt-3" />}
    </Card>
  );
}

/**
 * The filter the Home's cards bring (orders first paid that day), which has no field of its own:
 * a chosen chip (Graphite, Milk text) with a cross that drops it and keeps the other filters.
 */
function PaidOnChip({
  t,
  language,
  filters,
}: {
  t: AdminMessages;
  language: Language;
  filters: OrderFilters;
}) {
  const f = t.orders.filters;
  const label = fill(f.paidOn, { date: formatCalendarDate(filters.paidOn!, language) });
  const { paidOn: _dropped, ...rest } = filters;
  return (
    <div className="mt-3 flex">
      <span className="inline-flex h-[34px] max-w-full items-center gap-1 rounded-full bg-primary pr-1 pl-3.5 text-[13px] font-medium text-primary-foreground">
        <span className="truncate">{label}</span>
        <Link
          href={listHref('/orders', { view: 'list', ...rest })}
          aria-label={fill(f.paidOnRemove, { label })}
          className="grid size-[26px] shrink-0 place-items-center rounded-full transition-colors duration-150 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-milk/15"
        >
          <X className="size-4" strokeWidth={1.5} aria-hidden />
        </Link>
      </span>
    </div>
  );
}
