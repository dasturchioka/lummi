import * as React from 'react';
import { cn } from '@/lib/utils';

/** White on Milk, 12 px, flat: no border and no shadow (DESIGN.md "The Flat Box Rule"). */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-card bg-card text-foreground', className)} {...props} />;
}
