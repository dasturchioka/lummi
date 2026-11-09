import { ChevronDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** A native select (best on phones) in the `Input` surface with the panel's chevron. */
export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'h-11 w-full min-w-0 appearance-none rounded-button bg-field pr-10 pl-3.5 text-base text-foreground pointer-fine:text-[15px]',
          'shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-shadow duration-150',
          'hover:shadow-[inset_0_0_0_1px_var(--ink-faint)] aria-invalid:shadow-[inset_0_0_0_1.5px_var(--graphite)]',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-[18px] -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
    </div>
  );
}
