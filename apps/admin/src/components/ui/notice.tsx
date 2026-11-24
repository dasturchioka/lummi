import { CircleAlert, ShieldX } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Inline error, warning or blocked state: Graphite text on a light red Alert Wash plate with a
 * 1.5 px Alert icon (Sardor 2026-11-24: warnings read light red). Sale prices stay never red.
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
      className={cn(
        'flex gap-3 rounded-button bg-alert-wash px-4 py-3.5 text-foreground',
        className,
      )}
    >
      <Icon className="mt-px size-5 shrink-0 text-alert" strokeWidth={1.5} aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold leading-snug">{title}</p>
        {children && <div className="mt-1 text-[13px] text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
