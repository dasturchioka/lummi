'use client';

import { ORDER_PAYMENT_FILTERS } from '@lummi/contracts';
import { SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import type { AdminMessages } from '@/lib/i18n';
import { TEXT_LINK } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import type { OrderFilters } from '../orders-filters';

/**
 * The board's filters (#52): one row, so the board keeps the screen's height. The search (number
 * or phone) runs on Enter; «Фильтры» opens the payment state and the dates in a panel under it
 * (open while any is set), with «Показать». A plain GET form, as the list's: a filtered board
 * survives a reload and can be shared. No status here: on the board the status is the column.
 */
export function BoardFilters({ t, filters }: { t: AdminMessages; filters: OrderFilters }) {
  const f = t.orders.filters;
  const active = [filters.payment, filters.from, filters.to].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  const any = active > 0 || Boolean(filters.q);
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);

  return (
    <form
      method="get"
      action="/orders"
      role="search"
      className="mb-3 grid gap-2.5"
      data-board-filters
    >
      <div className="flex items-center gap-2">
        <label htmlFor="b-q" className="sr-only">
          {f.search}
        </label>
        <Input
          id="b-q"
          name="q"
          type="search"
          inputMode="tel"
          enterKeyHint="search"
          autoComplete="off"
          defaultValue={filters.q ?? ''}
          placeholder={f.searchPlaceholder}
          className="min-w-0 flex-1 sm:max-w-[22rem]"
        />
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls="b-panel"
          onClick={() => setOpen((v) => !v)}
          className="max-sm:w-11 max-sm:px-0"
        >
          <SlidersHorizontal strokeWidth={1.5} aria-hidden />
          <span className="max-sm:sr-only">{f.toggle}</span>
          {active > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums max-sm:absolute max-sm:-top-1.5 max-sm:-right-1.5">
              {active}
            </span>
          )}
        </Button>
        {any && (
          <Link href="/orders" className={cn(TEXT_LINK, 'ml-1 whitespace-nowrap max-sm:hidden')}>
            {f.reset}
          </Link>
        )}
      </div>
      <div
        id="b-panel"
        hidden={!open}
        className="grid gap-3 rounded-card bg-card p-4 sm:grid-cols-[repeat(3,minmax(0,13rem))_auto] sm:items-end"
      >
        <Field id="b-payment" label={f.payment}>
          <Select name="payment" defaultValue={filters.payment ?? ''}>
            <option value="">{f.all}</option>
            {ORDER_PAYMENT_FILTERS.map((p) => (
              <option key={p} value={p}>
                {t.orders.payment[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="b-from" label={f.from}>
          <Input type="date" name="from" defaultValue={filters.from ?? ''} />
        </Field>
        <Field id="b-to" label={f.to}>
          <Input type="date" name="to" defaultValue={filters.to ?? ''} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" className="max-sm:flex-1">
            {f.apply}
          </Button>
          {any && (
            <Button asChild variant="outline" className="max-sm:flex-1 sm:hidden">
              <Link href="/orders">{f.reset}</Link>
            </Button>
          )}
        </div>
      </div>
      {badRange && <Notice title={t.orders.badRange} />}
    </form>
  );
}
