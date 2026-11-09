import * as React from 'react';
import { cn } from '@/lib/utils';

/** DESIGN.md field: Milk Field fill, no border, 10 px radius. 16 px text on touch stops iOS zoom. */
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 w-full min-w-0 rounded-button bg-field px-3.5 text-base text-foreground pointer-fine:text-[15px]',
        'transition-shadow duration-150 placeholder:text-muted-foreground',
        'hover:shadow-[inset_0_0_0_1px_var(--hairline)] focus-visible:shadow-[inset_0_0_0_1px_var(--hairline-strong)]',
        'aria-invalid:shadow-[inset_0_0_0_1.5px_var(--graphite)] disabled:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
