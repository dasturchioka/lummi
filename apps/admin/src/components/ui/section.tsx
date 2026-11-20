import * as React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const headingClass = 'font-display text-[13px] leading-[1.35] tracking-[0.2em] uppercase';

/**
 * A card per part of a form, headed in the DESIGN.md Section role (Tenor caps, 13 px). An
 * optional small control (a RU / UZ switch) sits at the right end of the heading's line.
 */
export function Section({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('grid scroll-mt-24 content-start gap-5 p-4 sm:p-6', className)}>
      {action ? (
        <div className="flex min-h-8 items-center justify-between gap-3">
          <h2 className={headingClass}>{title}</h2>
          {action}
        </div>
      ) : (
        <h2 className={headingClass}>{title}</h2>
      )}
      {children}
    </Card>
  );
}
