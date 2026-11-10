import {
  useId,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertIcon, CheckIcon } from './icons';

/*
 * DESIGN.md Inputs: Milk Field fill, no border, 10 px radius, 48 px, 16 px text (no iOS zoom).
 * The label sits above in 12.5 px Manrope 500, Muted Ink; the hint below in 12 px. Focus is the
 * global 2 px Sage outline. An error is marked without red (the No Alarm Rule): an ink outline,
 * the alert icon inside the field, and the error line, led by the same icon, in place of the hint.
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

/**
 * The line under a control that says what it needs: the alert icon (the one on the checkout
 * banner «Проверьте отмеченные поля») then the text in ink, so it never reads as a hint. `inset`
 * lines the text up with a checkbox's label while the icon sits under the box.
 */
export function FieldError({
  id,
  inset = false,
  children,
}: {
  id?: string;
  inset?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      role="alert"
      className={`type-hint mt-1.5 flex items-start font-medium text-ink ${inset ? 'gap-3' : 'gap-1.5'}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-[17.4px] shrink-0 items-center ${inset ? 'w-[22px] justify-center' : ''}`}
      >
        <AlertIcon size={14} />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The alert icon inside an errored field, at its right edge. */
function ErrorMark({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute right-3.5 text-ink ${className}`}
    >
      <AlertIcon size={18} />
    </span>
  );
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
        <FieldError id={`${id}-hint`}>{error}</FieldError>
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
          className={`${FIELD} h-12 ${trailing ? 'pr-28' : error ? 'pr-11' : ''} ${error ? 'shadow-[inset_0_0_0_1px_var(--c-ink)]' : ''} ${className}`}
          {...input}
        />
        {trailing ? (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center">
            {trailing}
          </span>
        ) : error ? (
          <ErrorMark className="top-1/2 -translate-y-1/2" />
        ) : null}
      </span>
    </Frame>
  );
}

/**
 * Grows with its text (a greeting at its limit reads whole, never scrolled inside a 3-line box),
 * from its `rows` up to 240 px, then scrolls.
 */
export function TextArea({
  label,
  aside,
  hint,
  error,
  className = '',
  ...area
}: FieldFrame & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [area.value]);
  return (
    <Frame id={id} label={label} aside={aside} hint={hint} error={error}>
      <span className="relative block">
        <textarea
          ref={ref}
          id={id}
          aria-describedby={hint || error ? `${id}-hint` : undefined}
          aria-invalid={error ? true : undefined}
          className={`${FIELD} block max-h-[240px] min-h-[88px] resize-none py-3 leading-snug ${error ? 'pr-11 shadow-[inset_0_0_0_1px_var(--c-ink)]' : ''} ${className}`}
          {...area}
        />
        {error ? <ErrorMark className="top-3.5" /> : null}
      </span>
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
    <label
      className="group flex min-h-11 cursor-pointer items-start gap-3 py-1 select-none"
      data-testid={testId}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-invalid={invalid || undefined}
        className="peer sr-only"
      />
      {/* pressed, the box gives a little; the check grows in from 60 % on the way on, never from nothing */}
      <span
        aria-hidden="true"
        className={`mt-px grid size-[22px] shrink-0 place-items-center rounded-[6px] transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-active:scale-[0.92] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sage ${
          checked
            ? 'bg-btn text-btn-ink'
            : invalid
              ? // left empty where it is required: filled and ink-ringed, not the quiet hairline box
                'bg-field shadow-[inset_0_0_0_1.5px_var(--c-ink)]'
              : 'inset-line bg-transparent'
        }`}
      >
        <span
          className={`grid place-items-center transition-[opacity,transform] ease-[cubic-bezier(0.23,1,0.32,1)] ${
            checked ? 'scale-100 opacity-100 duration-200' : 'scale-[0.6] opacity-0 duration-100'
          }`}
        >
          <CheckIcon size={16} strokeWidth={2} />
        </span>
      </span>
      <span className="type-body min-w-0 flex-1 text-pretty text-ink">{children}</span>
    </label>
  );
}
