'use client';

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

export type AuditFilters = { actor?: string; action?: string; from?: string; to?: string };

/**
 * The audit filters: a plain GET form (the URL is the state, so a filtered view can be linked).
 * Phones show «Фильтры» with the count in use and open the fields behind it (open while any is
 * set), as the catalog does; wider screens always show them.
 */
export function AuditFiltersForm({
  t,
  filters,
  actors,
  actions,
}: {
  t: AdminMessages;
  filters: AuditFilters;
  actors: { value: string; label: string }[];
  actions: { value: string; label: string }[];
}) {
  const f = t.audit.filters;
  const active = [filters.actor, filters.action, filters.from, filters.to].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const hidden = !open && 'max-sm:hidden';

  return (
    <Card className="mb-4 p-4 lg:p-5">
      <form
        method="get"
        action="/audit"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
      >
        <div className="flex gap-2 sm:hidden">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            aria-expanded={open}
            aria-controls="f-actor f-action f-from f-to"
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
              <Link href="/audit">{f.reset}</Link>
            </Button>
          )}
        </div>
        {/* the names and action labels need the width; the dates are short */}
        <Field id="f-actor" label={f.actor} className={cn('lg:col-span-2', hidden)}>
          <Select name="actor" defaultValue={filters.actor ?? ''}>
            <option value="">{f.all}</option>
            {actors.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-action" label={f.action} className={cn('lg:col-span-2', hidden)}>
          <Select name="action" defaultValue={filters.action ?? ''}>
            <option value="">{f.all}</option>
            {actions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
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
        <div className={cn('flex gap-2 sm:col-span-2 lg:justify-end', !open && 'max-sm:hidden')}>
          <Button type="submit" className="max-sm:flex-1">
            {f.apply}
          </Button>
          {active > 0 && (
            <Button asChild variant="outline" className="max-sm:hidden">
              <Link href="/audit">{f.reset}</Link>
            </Button>
          )}
        </div>
      </form>
      {badRange && <Notice title={t.audit.badRange} className="mt-3" />}
    </Card>
  );
}
