import { CircleAlert } from 'lucide-react';
import * as React from 'react';
import { Monogram } from '@/components/logo';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Empty and failed states share one block: a 56 px disc (the "L." monogram on Stone when there
 * is simply nothing yet, an alert icon on Milk Field when loading failed), a short title, what
 * happens next, and at most one action.
 */
export function EmptyState({
  title,
  children,
  action,
  tone = 'empty',
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'empty' | 'error';
  className?: string;
}) {
  return (
    <Card
      role={tone === 'error' ? 'alert' : undefined}
      className={cn('flex flex-col items-center px-6 py-12 text-center sm:py-16', className)}
    >
      <div
        className={cn(
          'grid size-14 place-items-center rounded-full',
          tone === 'error' ? 'bg-field' : 'bg-stone',
        )}
      >
        {tone === 'error' ? (
          <CircleAlert className="size-6" strokeWidth={1.5} aria-hidden />
        ) : (
          <Monogram className="h-[22px]" />
        )}
      </div>
      <h2 className="mt-5 text-base font-semibold text-balance">{title}</h2>
      {children && (
        <div className="mt-1.5 max-w-[46ch] text-sm text-pretty text-muted-foreground">
          {children}
        </div>
      )}
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}
