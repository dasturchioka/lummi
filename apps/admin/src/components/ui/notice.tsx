import { CircleAlert, ShieldX } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Inline error or blocked state: Graphite on a Milk Field plate with a 1.5 px icon. The admin
 * never signals with red (DESIGN.md "The No Alarm Rule"); the icon and the wording carry it.
 */
export function Notice({
  title,
  children,
  icon = 'alert',
  className,
}: {
  title: string;
  children?: React.ReactNode;
  icon?: 'alert' | 'blocked';
  className?: string;
}) {
  const Icon = icon === 'blocked' ? ShieldX : CircleAlert;
  return (
    <div
      role="alert"
      className={cn('flex gap-3 rounded-button bg-field px-4 py-3.5 text-foreground', className)}
    >
      <Icon className="mt-px size-5 shrink-0" strokeWidth={1.5} aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold leading-snug">{title}</p>
        {children && <p className="mt-1 text-[13px] text-muted-foreground">{children}</p>}
      </div>
    </div>
  );
}
