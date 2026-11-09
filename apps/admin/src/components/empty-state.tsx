import { CircleAlert, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { Monogram } from '@/components/logo';
import { SectionIcon } from '@/components/section-icon';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Empty and failed states share one block: a 56 px disc, a short title, what happens next, and
 * at most one action. The disc holds the section's menu icon on Stone by default (pass `icon` to
 * choose another), the "L." monogram only on home and the 404 (`icon="monogram"`), and an alert
 * icon on Milk Field when loading failed (`tone="error"`).
 */
export function EmptyState({
  title,
  children,
  action,
  tone = 'empty',
  icon,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'empty' | 'error';
  icon?: LucideIcon | 'monogram';
  className?: string;
}) {
  const Icon = tone === 'error' ? CircleAlert : icon === 'monogram' ? null : icon;
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
        {Icon ? (
          <Icon className="size-6" strokeWidth={1.5} aria-hidden />
        ) : icon === 'monogram' ? (
          <Monogram className="h-[22px]" />
        ) : (
          <SectionIcon />
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
