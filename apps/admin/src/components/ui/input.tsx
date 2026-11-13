import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * DESIGN.md field: Milk Field fill, 10 px radius, plus (admin only, recorded in DESIGN.md) a
 * resting hairline-strong inset outline so a field reads as a field on white cards and dialogs.
 * 16 px text on touch stops iOS zoom.
 */
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 w-full min-w-0 rounded-button bg-field px-3.5 text-base text-foreground pointer-fine:text-[15px]',
        'shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-shadow duration-150 placeholder:text-muted-foreground',
        'enabled:hover:shadow-[inset_0_0_0_1px_var(--ink-faint)] aria-invalid:shadow-[inset_0_0_0_1.5px_var(--graphite)]',
        'disabled:cursor-not-allowed disabled:text-faint disabled:shadow-[inset_0_0_0_1px_var(--hairline)]',
        className,
      )}
      {...props}
    />
  );
}
