import * as React from 'react';
import { cn } from '@/lib/utils';

/** A native select dressed like `Input` (the native picker is the right control on a phone). */
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-11 w-full min-w-0 rounded-button bg-field px-3 text-base text-foreground pointer-fine:text-[15px]',
        'shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-shadow duration-150',
        'hover:shadow-[inset_0_0_0_1px_var(--ink-faint)] disabled:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
