import * as React from 'react';
import { cn } from '@/lib/utils';

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: React.ComponentProps<'span'> & { tone?: 'neutral' | 'sage' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tone === 'sage' ? 'bg-sage/25 text-foreground' : 'bg-muted text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
