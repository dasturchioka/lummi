import { useRef, type KeyboardEvent } from 'react';

/**
 * The approved filter chip (variant 2): a 40 px pill with a round 3:4 bottle photo cropped to a
 * 30 px circle, then the label. Inactive is a Card White pill (Graphite in dark), active is the
 * primary fill (Graphite with Milk text; inverted in dark). No outline, no shadow.
 * In-page filters use this; `Segmented` is for settings only.
 */
export function Chip({
  label,
  thumb,
  selected = false,
  onClick,
  pressed,
  role,
  tabIndex,
  onKeyDown,
  buttonRef,
}: {
  label: string;
  /** A bottle photo URL; without it the chip is a plain label pill. */
  thumb?: string;
  selected?: boolean;
  onClick?: () => void;
  /** Force the pressed look (component gallery). */
  pressed?: boolean;
  role?: 'radio';
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role={role}
      aria-checked={role === 'radio' ? selected : undefined}
      aria-pressed={role === 'radio' ? undefined : selected}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
      data-pressed={pressed || undefined}
      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-pill text-[13px] leading-none font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] data-[pressed]:scale-[0.97] ${
        thumb ? 'pr-4 pl-[5px]' : 'px-4'
      } ${selected ? 'bg-btn font-semibold text-btn-ink' : 'bg-card text-ink'}`}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          aria-hidden="true"
          decoding="async"
          className="size-[30px] shrink-0 rounded-pill bg-photo object-cover object-[50%_40%]"
        />
      ) : null}
      {label}
    </button>
  );
}

export interface TypeChipOption<V extends string> {
  value: V;
  label: string;
  thumb?: string;
}

/**
 * The type filter row (Все / Homme / Femme / Unisex / Наборы): one choice, a horizontal row that
 * scrolls under the screen gutters with no visible scrollbar. Arrow keys move the choice.
 */
export function TypeChips<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: TypeChipOption<V>[];
  value: V;
  onChange: (value: V) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + options.length) % options.length;
    const opt = options[next];
    if (opt) {
      onChange(opt.value);
      refs.current[next]?.focus();
    }
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="-mx-[var(--gutter)] flex gap-2 overflow-x-auto overscroll-x-contain px-[var(--gutter)] py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((o, i) => (
        <Chip
          key={o.value}
          role="radio"
          label={o.label}
          thumb={o.thumb}
          selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
          buttonRef={(el) => {
            refs.current[i] = el;
          }}
        />
      ))}
    </div>
  );
}
