import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Form field: label above (12.5 px, Muted Ink), control, hint below. Pass the control as the
 * child; `id` ties the label and the hint to it.
 */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  /** A validation message; replaces the hint and marks the control. */
  error?: string;
  className?: string;
  children: React.ReactElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }>;
}) {
  const hintId = error || hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted-foreground">
        {label}
      </label>
      {React.cloneElement(children, {
        id,
        'aria-describedby': hintId,
        'aria-invalid': error ? true : undefined,
      })}
      {(error || hint) && (
        <p
          id={hintId}
          className={cn(
            'text-xs leading-snug',
            error ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
