'use client';

import { REVIEW_PUBLISHED_FILTERS } from '@lummi/contracts';
import { ListFilters } from '@/components/list-filters';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { AdminMessages } from '@/lib/i18n';

export type ReviewFilters = { rating?: string; state?: string; from?: string; to?: string };

/**
 * The reviews filters: a plain GET form, so a filtered view survives a reload and can be shared
 * (the Excel export takes the same query). On phones the four fields open behind «Фильтры».
 */
export function ReviewsFiltersForm({ t, filters }: { t: AdminMessages; filters: ReviewFilters }) {
  const f = t.reviews.filters;
  const active = Object.values(filters).filter(Boolean).length;
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  return (
    <ListFilters
      action="/reviews"
      active={active}
      labels={f}
      warning={badRange ? t.reviews.badRange : undefined}
    >
      <Field id="f-rating" label={f.rating}>
        <Select name="rating" defaultValue={filters.rating ?? ''}>
          <option value="">{f.all}</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="f-state" label={f.state}>
        <Select name="state" defaultValue={filters.state ?? ''}>
          <option value="">{f.all}</option>
          {REVIEW_PUBLISHED_FILTERS.map((s) => (
            <option key={s} value={s}>
              {f[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="f-from" label={f.from}>
        <Input type="date" name="from" defaultValue={filters.from ?? ''} />
      </Field>
      <Field id="f-to" label={f.to}>
        <Input type="date" name="to" defaultValue={filters.to ?? ''} />
      </Field>
    </ListFilters>
  );
}
