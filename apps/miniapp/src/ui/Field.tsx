import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { CheckIcon } from './icons';

/*
 * DESIGN.md Inputs: Milk Field fill, no border, 10 px radius, 48 px, 16 px text (no iOS zoom).
 * The label sits above in 12.5 px Manrope 500, Muted Ink; the hint below in 12 px. Focus is the
 * global 2 px Sage outline. An error replaces the hint in ink with the alert's weight.
 */
const FIELD =
  'w-full rounded-btn bg-field px-3.5 text-base text-ink placeholder:text-muted disabled:text-muted';

interface FieldFrame {
  label: string;
  /** Shown at the label's right in Muted Ink («необязательно»). */
  aside?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
}

function Frame({
  id,
  label,
  aside,
  hint,
  error,
  children,
}: FieldFrame & { id: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="type-small font-medium text-muted">
          {label}
        </label>
        {aside ? <span className="type-small text-muted">{aside}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={`${id}-hint`} role="alert" className="type-hint mt-1.5 font-medium text-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="type-hint mt-1.5 text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  aside,
  hint,
  error,
  trailing,
  className = '',
  ...input
}: FieldFrame & { trailing?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Frame id={id} label={label} aside={aside} hint={hint} error={error}>
      <span className="relative block">
        <input
          id={id}
          aria-describedby={hint || error ? `${id}-hint` : undefined}
          aria-invalid={error ? true : undefined}
          className={`${FIELD} h-12 ${trailing ? 'pr-28' : ''} ${error ? 'shadow-[inset_0_0_0_1px_var(--c-ink)]' : ''} ${className}`}
          {...input}
        />
        {trailing ? (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center">
            {trailing}
          </span>
        ) : null}
      </span>
    </Frame>
  );
}

export function TextArea({
  label,
  aside,
  hint,
  error,
  className = '',
  ...area
}: FieldFrame & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Frame id={id} label={label} aside={aside} hint={hint} error={error}>
      <textarea
        id={id}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        className={`${FIELD} block min-h-[88px] resize-none py-3 leading-snug ${className}`}
        {...area}
      />
    </Frame>
  );
}

/**
 * A square check (mockup 06 consent): 22 px, 6 px corners, a hairline outline when off, the
 * primary fill with a Milk check when on (inverted in dark). The whole row is the target.
 */
export function Checkbox({
  checked,
  onChange,
  children,
  testId,
  invalid = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  testId?: string;
  /** Left unchecked where it is required: an ink outline, and the caller says why below. */
  invalid?: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1" data-testid={testId}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-invalid={invalid || undefined}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-px grid size-[22px] shrink-0 place-items-center rounded-[6px] transition-[background-color,box-shadow] duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sage ${
          checked
            ? 'bg-btn text-btn-ink'
            : invalid
              ? 'bg-transparent text-transparent shadow-[inset_0_0_0_1.5px_var(--c-ink)]'
              : 'inset-line bg-transparent text-transparent'
        }`}
      >
        <CheckIcon size={16} strokeWidth={2} />
      </span>
      <span className="type-body min-w-0 flex-1 text-pretty text-ink">{children}</span>
    </label>
  );
}
