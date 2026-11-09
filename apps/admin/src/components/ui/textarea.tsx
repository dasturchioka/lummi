import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Same field surface as `Input`, for longer text. It grows with its text up to 384 px (where the
 * browser supports `field-sizing`), so a long RU/UZ description reads whole.
 */
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'field-sizing-content min-h-24 max-h-96 w-full min-w-0 resize-y rounded-button bg-field px-3.5 py-2.5 text-base leading-snug text-foreground pointer-fine:text-[15px]',
        'shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-shadow duration-150 placeholder:text-muted-foreground',
        'hover:shadow-[inset_0_0_0_1px_var(--ink-faint)] aria-invalid:shadow-[inset_0_0_0_1.5px_var(--graphite)]',
        className,
      )}
      {...props}
    />
  );
}
