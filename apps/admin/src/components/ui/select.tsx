'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * One dropdown for the whole admin. It takes `<option>` children and the props of a native
 * `<select>`, so callers, react-hook-form `register()` and FormData keep working unchanged.
 *
 * - Fine pointer (desktop): a Radix listbox popover drawn with the design tokens. A real native
 *   select stays in the DOM, visually hidden, as the source of truth: it carries `name`, `ref`,
 *   `onChange` and the form value, and the popover writes to it and dispatches a `change` event.
 * - Coarse pointer (phones): that native select is shown (the best picker on touch).
 * The pointer kind is read after mount with `useSyncExternalStore` (native on the server), so
 * there is no hydration mismatch.
 */

type Option = { value: string; label: string; disabled: boolean };

// Radix forbids an item with value "" (it means "clear"), so the empty choice maps to a sentinel.
const EMPTY = '__empty__';
const toItem = (v: string) => (v === '' ? EMPTY : v);
const fromItem = (v: string) => (v === EMPTY ? '' : v);

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function collectOptions(children: React.ReactNode, out: Option[] = []): Option[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<React.ComponentProps<'option'> & { children?: React.ReactNode }>(child))
      return;
    if (child.type === 'option') {
      const label = textOf(child.props.children);
      out.push({
        value: child.props.value === undefined ? label : String(child.props.value),
        label,
        disabled: !!child.props.disabled,
      });
    } else {
      collectOptions(child.props.children, out); // fragments, optgroups
    }
  });
  return out;
}

const FINE = '(pointer: fine)';
function subscribePointer(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(FINE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const finePointer = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(FINE).matches;
function useFinePointer() {
  return React.useSyncExternalStore(subscribePointer, finePointer, () => false);
}

const surface = cn(
  'h-11 w-full min-w-0 rounded-button bg-field text-base text-foreground pointer-fine:text-[15px]',
  'shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-shadow duration-150',
  'hover:shadow-[inset_0_0_0_1px_var(--ink-faint)] aria-invalid:shadow-[inset_0_0_0_1.5px_var(--graphite)] disabled:text-muted-foreground',
);

export function Select({
  className,
  children,
  id,
  value,
  defaultValue,
  onChange,
  disabled,
  ref,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: React.ComponentProps<'select'>) {
  const fine = useFinePointer();
  const options = React.useMemo(() => collectOptions(children), [children]);
  const nativeRef = React.useRef<HTMLSelectElement | null>(null);
  const controlled = value !== undefined;
  const [inner, setInner] = React.useState(() =>
    defaultValue !== undefined ? String(defaultValue) : (options[0]?.value ?? ''),
  );
  const current = controlled ? String(value) : inner;

  // The native select is the source of truth when uncontrolled: react-hook-form and form resets
  // write to it directly, so mirror it after every render.
  React.useLayoutEffect(() => {
    const el = nativeRef.current;
    if (!controlled && el && el.value !== inner) setInner(el.value);
  });

  const setRefs = (el: HTMLSelectElement | null) => {
    nativeRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  const pick = (item: string) => {
    const next = fromItem(item);
    const el = nativeRef.current;
    if (!el || next === el.value) return;
    el.value = next;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (!controlled) setInner(next);
  };

  const selected = options.find((o) => o.value === current);
  const selectedItem = toItem(current);

  return (
    <div className="relative">
      <select
        {...props}
        ref={setRefs}
        id={fine ? undefined : id}
        {...(controlled ? { value } : { defaultValue })}
        onChange={(e) => {
          onChange?.(e);
          if (!controlled) setInner(e.target.value);
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        tabIndex={fine ? -1 : props.tabIndex}
        aria-hidden={fine ? true : undefined}
        className={cn(
          surface,
          'appearance-none pr-10 pl-3.5',
          fine && 'sr-only',
          !fine && className,
        )}
      >
        {children}
      </select>
      {fine ? (
        <SelectPrimitive.Root value={selectedItem} onValueChange={pick} disabled={disabled}>
          <SelectPrimitive.Trigger
            id={id}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            className={cn(
              surface,
              'flex items-center justify-between gap-2 pr-3 pl-3.5 text-left outline-offset-2 active:scale-[0.995]',
              'data-[state=open]:shadow-[inset_0_0_0_1px_var(--ink-faint)]',
              selected?.disabled && 'text-muted-foreground',
              className,
            )}
          >
            <span className="min-w-0 truncate">
              <SelectPrimitive.Value>{selected?.label}</SelectPrimitive.Value>
            </span>
            <SelectPrimitive.Icon asChild>
              <ChevronDown
                className="size-[18px] shrink-0 text-muted-foreground transition-transform duration-150 [[data-state=open]>&]:rotate-180"
                strokeWidth={1.5}
                aria-hidden
              />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              sideOffset={6}
              collisionPadding={12}
              className={cn(
                'motion-select z-[70] max-h-[min(320px,var(--radix-select-content-available-height))] w-[max(var(--radix-select-trigger-width),180px)] max-w-[min(480px,calc(100vw-24px))]',
                'overflow-hidden rounded-card border border-border-strong bg-card text-foreground',
              )}
            >
              <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto overscroll-contain p-1.5">
                {options.map((o) => (
                  <SelectPrimitive.Item
                    key={o.value}
                    value={toItem(o.value)}
                    disabled={o.disabled}
                    className={cn(
                      'relative flex min-h-9 cursor-default items-start gap-2 rounded-button py-2 pr-2.5 pl-8 text-[15px] leading-snug outline-none select-none',
                      'data-[highlighted]:bg-field data-[disabled]:text-faint data-[state=checked]:font-medium',
                    )}
                  >
                    <SelectPrimitive.ItemIndicator className="absolute top-[9px] left-2.5">
                      <Check className="size-4 text-sage-ink" strokeWidth={1.5} aria-hidden />
                    </SelectPrimitive.ItemIndicator>
                    <SelectPrimitive.ItemText>
                      <span className="[overflow-wrap:anywhere]">{o.label}</span>
                    </SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
      ) : (
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3 size-[18px] -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
      )}
    </div>
  );
}
