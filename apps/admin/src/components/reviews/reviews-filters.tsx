'use client';

import { REVIEW_PUBLISHED_FILTERS } from '@lummi/contracts';
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

export type ReviewFilters = { rating?: string; state?: string; from?: string; to?: string };

/**
 * The reviews filters: a plain GET form, so a filtered view survives a reload and can be shared
 * (the Excel export takes the same query). On phones the four fields open behind «Фильтры».
 */
export function ReviewsFiltersForm({ t, filters }: { t: AdminMessages; filters: ReviewFilters }) {
  const f = t.reviews.filters;
  const active = Object.values(filters).filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const hidden = !open && 'max-sm:hidden';

  return (
    <Card className="mb-4 p-4 lg:p-5">
      <form
        method="get"
        action="/reviews"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end"
      >
        <div className="flex gap-2 sm:hidden">
          <Button type="submit" className="flex-1">
            {f.apply}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-expanded={open}
            aria-controls="f-rating f-state f-from f-to"
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
        <Field id="f-rating" label={f.rating} className={cn(hidden)}>
          <Select name="rating" defaultValue={filters.rating ?? ''}>
            <option value="">{f.all}</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-state" label={f.state} className={cn(hidden)}>
          <Select name="state" defaultValue={filters.state ?? ''}>
            <option value="">{f.all}</option>
            {REVIEW_PUBLISHED_FILTERS.map((s) => (
              <option key={s} value={s}>
                {f[s]}
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
            open && active > 0 && 'max-sm:flex',
          )}
        >
          <Button type="submit" className="max-sm:hidden">
            {f.apply}
          </Button>
          {active > 0 && (
            <Button asChild variant="outline" className="max-sm:flex-1">
              <Link href="/reviews">{f.reset}</Link>
            </Button>
          )}
        </div>
      </form>
      {badRange && <Notice title={t.reviews.badRange} className="mt-3" />}
    </Card>
  );
}
