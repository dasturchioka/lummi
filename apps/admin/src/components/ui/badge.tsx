import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Status pill. `sage`: confirmed / on (Sage Wash, Sage Ink, filled Sage dot). `neutral`: off
 * (Milk Field, Muted Ink, hollow dot). `live`: under way (Milk Field, Graphite, a Sage dot that
 * breathes; still for reduced motion). `calm`: a state that may last weeks (Milk Field, Muted Ink,
 * a still dot). `look`: needs a look (Ink 600, a hollow 1.5 px Graphite ring; never red). The dot keeps the state readable without colour.
 */
export function Badge({
  className,
  tone = 'neutral',
  children,
  ...props
}: React.ComponentProps<'span'> & { tone?: 'neutral' | 'sage' | 'live' | 'calm' | 'look' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold',
        tone === 'sage'
          ? 'bg-sage-wash text-sage-ink'
          : tone === 'live'
            ? 'bg-field text-foreground'
            : tone === 'look'
              ? 'bg-field text-foreground'
              : 'bg-field text-muted-foreground',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          tone === 'sage' && 'bg-sage',
          tone === 'live' &&
            'animate-[breathe_1.6s_ease-in-out_infinite] bg-sage motion-reduce:animate-none',
          tone === 'neutral' && 'shadow-[inset_0_0_0_1.25px_var(--ink-faint)]',
          tone === 'calm' && 'bg-faint',
          tone === 'look' && 'shadow-[inset_0_0_0_1.5px_var(--graphite)]',
        )}
      />
      {children}
    </span>
  );
}
