'use client';

import { ChevronDown } from 'lucide-react';
import * as React from 'react';
import { matchesSearch } from '@/lib/search-match';
import { cn } from '@/lib/utils';

export type ComboboxOption = {
  value: string;
  label: string;
  /** Extra text the search also looks at. */
  keywords?: string;
  /** Drawn in the muted colour (still pickable), e.g. nothing available. */
  muted?: boolean;
};

/**
 * A searchable single-choice picker (ARIA 1.2 combobox with a listbox popup). Type to filter
 * (case, diacritics and apostrophes ignored, words in any order), arrows + Enter or a tap to
 * pick, Escape to close. Looks like `Input`/`Select`; the list opens inline under the field.
 */
export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder,
  emptyText,
  className,
  disabled,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: {
  id?: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText: string;
  className?: string;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const uid = React.useId();
  const listId = `${uid}-list`;
  const [query, setQuery] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const shown = React.useMemo(
    () =>
      query === null || query.trim() === ''
        ? options
        : options.filter((o) => matchesSearch(`${o.label} ${o.keywords ?? ''}`, query)),
    [options, query],
  );
  const optId = (i: number) => `${uid}-opt-${i}`;

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const pick = (o: ComboboxOption) => {
    onChange(o.value);
    close();
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? optId(active) : undefined}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={query ?? selected?.label ?? ''}
        onFocus={(e) => {
          e.currentTarget.select();
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            else setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault(); // never submit the form from the picker
            const o = shown[active];
            if (o) pick(o);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
        className={cn(
          'h-11 w-full min-w-0 rounded-button bg-field pr-10 pl-3.5 text-base text-foreground pointer-fine:text-[15px]',
          'shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-shadow duration-150 placeholder:text-muted-foreground',
          'enabled:hover:shadow-[inset_0_0_0_1px_var(--ink-faint)] aria-invalid:shadow-[inset_0_0_0_1.5px_var(--graphite)]',
          'disabled:cursor-not-allowed disabled:text-faint disabled:shadow-[inset_0_0_0_1px_var(--hairline)]',
          className,
        )}
      />
      <ChevronDown
        strokeWidth={1.5}
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 right-3 size-[18px] -translate-y-1/2 text-muted-foreground transition-transform duration-150',
          open && 'rotate-180',
        )}
      />
      {open && (
        <div
          className="absolute top-full right-0 left-0 z-[60] mt-1.5 overflow-hidden rounded-card border border-border-strong bg-card text-foreground"
          // Keep focus in the input while the list is pressed.
          onMouseDown={(e) => e.preventDefault()}
        >
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="max-h-[min(320px,50vh)] overflow-y-auto overscroll-contain p-1.5"
          >
            {shown.map((o, i) => (
              <li
                key={o.value}
                id={optId(i)}
                role="option"
                aria-selected={o.value === value}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => pick(o)}
                className={cn(
                  'min-h-9 cursor-default rounded-button px-2.5 py-2 text-[15px] leading-snug select-none [overflow-wrap:anywhere]',
                  i === active && 'bg-field',
                  o.value === value && 'font-medium',
                  o.muted && 'text-muted-foreground',
                )}
              >
                {o.label}
              </li>
            ))}
          </ul>
          {shown.length === 0 && (
            <p role="status" className="px-3 py-3 text-[15px] text-muted-foreground">
              {emptyText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
