'use client';

import { ORDER_PAYMENT_FILTERS, ORDER_STATUSES } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import { SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import type { AdminMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type OrderFilters = {
  q?: string;
  status?: string;
  payment?: string;
  from?: string;
  to?: string;
};

/**
 * The orders filters: a plain GET form, so a filtered view survives a reload and can be shared.
 * The search (number or phone) is always in view; on phones the other fields open behind
 * «Фильтры» (open while any is set), as the catalog and the audit do. The board (#52) has no
 * status field: there the status is the column.
 */
export function OrdersFiltersForm({
  t,
  language,
  filters,
  view,
}: {
  t: AdminMessages;
  language: Language;
  filters: OrderFilters;
  view: 'board' | 'list';
}) {
  const f = t.orders.filters;
  const board = view === 'board';
  const reset = board ? '/orders' : '/orders?view=list';
  const active = [
    board ? undefined : filters.status,
    filters.payment,
    filters.from,
    filters.to,
  ].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  const any = active > 0 || Boolean(filters.q);
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const hidden = !open && 'max-sm:hidden';
  const statuses = ordersMessages[language].orders.status;

  return (
    <Card className="mb-4 p-4 lg:p-5">
      <form
        method="get"
        action="/orders"
        className={cn(
          'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:items-end',
          board
            ? 'lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_auto]'
            : 'lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))_auto]',
        )}
      >
        {!board && <input type="hidden" name="view" value="list" />}
        <Field id="f-q" label={f.search} className="sm:col-span-2 lg:col-span-1">
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
            aria-controls={board ? 'f-payment f-from f-to' : 'f-status f-payment f-from f-to'}
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
        {!board && (
          <Field id="f-status" label={f.status} className={cn(hidden)}>
            <Select name="status" defaultValue={filters.status ?? ''}>
              <option value="">{f.all}</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statuses[s]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="f-payment" label={f.payment} className={cn(hidden)}>
          <Select name="payment" defaultValue={filters.payment ?? ''}>
            <option value="">{f.all}</option>
            {ORDER_PAYMENT_FILTERS.map((p) => (
              <option key={p} value={p}>
                {t.orders.payment[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-from" label={f.from} className={cn(hidden)}>
          <Input type="date" name="from" defaultValue={filters.from ?? ''} />
        </Field>
        <Field id="f-to" label={f.to} className={cn(hidden)}>
          <Input type="date" name="to" defaultValue={filters.to ?? ''} />
        </Field>
        <div
          className={cn(
            'flex gap-2 sm:col-span-2 sm:justify-end lg:col-span-1',
            'max-sm:hidden',
            open && any && 'max-sm:flex',
          )}
        >
          <Button type="submit" className="max-sm:hidden">
            {f.apply}
          </Button>
          {any && (
            <Button asChild variant="outline" className="max-sm:flex-1">
              <Link href={reset}>{f.reset}</Link>
            </Button>
          )}
        </div>
      </form>
      {badRange && <Notice title={t.orders.badRange} className="mt-3" />}
    </Card>
  );
}
