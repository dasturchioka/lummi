'use client';

import { SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';

/**
 * A list's filters as a plain GET form (a filtered view survives a reload and can be shared). On
 * phones the fields open behind «Фильтры», with the count of those set; from 640 px they sit in a
 * row. `children` are the `Field`s; each one is given `hidden` by wrapping, so they hide as a unit.
 */
export function ListFilters({
  action,
  active,
  labels,
  warning,
  children,
}: {
  action: string;
  /** How many filters are set. */
  active: number;
  labels: { toggle: string; apply: string; reset: string };
  /** A notice under the form (an empty date range). */
  warning?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(active > 0);
  return (
    <Card className="mb-4 p-4 lg:p-5">
      <form method="get" action={action} className="grid grid-cols-1 gap-3">
        <div className="flex gap-2 sm:hidden">
          <Button type="submit" className="flex-1">
            {labels.apply}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-expanded={open}
            aria-controls="list-filter-fields"
            onClick={() => setOpen((v) => !v)}
          >
            <SlidersHorizontal strokeWidth={1.5} aria-hidden />
            {labels.toggle}
            {active > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                {active}
              </span>
            )}
          </Button>
        </div>
        <div
          id="list-filter-fields"
          className={cn(
            'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] lg:items-end',
            !open && 'max-sm:hidden',
          )}
        >
          {children}
        </div>
        <div className={cn('flex gap-2 sm:justify-end', !open && 'max-sm:hidden')}>
          <Button type="submit" className="max-sm:hidden">
            {labels.apply}
          </Button>
          {active > 0 && (
            <Button asChild variant="outline" className="max-sm:flex-1">
              <Link href={action}>{labels.reset}</Link>
            </Button>
          )}
        </div>
      </form>
      {warning && <Notice title={warning} className="mt-3" />}
    </Card>
  );
}
