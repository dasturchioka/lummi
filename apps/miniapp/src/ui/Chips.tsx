import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * The type chip's 30 px circle. The bottle photo is a whole 3:4 label (text, icons, the stand), so
 * a plain cover crop shows a peach blur with a 3 px bottle; the circle zooms in on the bottle's
 * shoulders and label instead, as the comp draws it. No photo yet (the list is still loading, or
 * failed): the empty circle holds the place, so the row never shifts when the photos arrive.
 */
function ChipCircle({ thumb, icon }: { thumb?: string | null; icon?: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={`relative grid size-[30px] shrink-0 place-items-center overflow-hidden rounded-pill ${
        icon ? 'bg-block text-ink' : 'bg-photo'
      }`}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          decoding="async"
          className="absolute top-[-64%] left-[-45%] aspect-[3/4] w-[190%] max-w-none"
        />
      ) : (
        icon
      )}
    </span>
  );
}

/**
 * The in-page filter chips.
 *
 * - `variant="type"` (default, approved variant 2): a 40 px pill with a round bottle photo (or an
 *   icon, or an empty circle while the photo loads) cropped to 30 px, then the label. Inactive is a
 *   Card White pill (Graphite in dark), active is the primary fill (Graphite with Milk text;
 *   inverted in dark) at 600.
 * - `variant="filter"` (DESIGN.md Chips): a 34 px pill with a hairline-strong inset outline, for a
 *   chip that opens a sheet (Семейство / Объём / Цена / Сезон). Chosen, it takes the primary fill
 *   and shows the value. A step quieter than the type chips above it, so the two rows read as
 *   "what kind" and "narrow it down".
 *
 * No shadow. `Segmented` is for settings only.
 */
export function Chip({
  label,
  variant = 'type',
  thumb,
  icon,
  trailing,
  selected = false,
  onClick,
  pressed,
  role,
  tabIndex,
  onKeyDown,
  buttonRef,
}: {
  label: string;
  variant?: 'type' | 'filter';
  /** Type chips: the bottle photo URL; `null` while there is none yet (an empty circle). */
  thumb?: string | null;
  /** Type chips without a photo of their own («Наборы»): a line icon on a Stone circle. */
  icon?: ReactNode;
  /** After the label: the chevron of a chip that opens a sheet. */
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** Force the pressed look (component gallery). */
  pressed?: boolean;
  role?: 'radio';
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const filter = variant === 'filter';
  const look = filter
    ? `h-[34px] gap-1.5 px-3.5 ${
        selected
          ? 'bg-btn font-semibold text-btn-ink'
          : 'text-ink shadow-[inset_0_0_0_1px_var(--c-line-strong)]'
      }`
    : `h-10 gap-2 pr-4 pl-[5px] ${selected ? 'bg-btn font-semibold text-btn-ink' : 'bg-card text-ink'}`;
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
      className={`inline-flex shrink-0 items-center rounded-pill text-[13px] leading-none font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] data-[pressed]:scale-[0.97] ${look}`}
    >
      {filter ? null : <ChipCircle thumb={thumb} icon={icon} />}
      {label}
      {trailing}
    </button>
  );
}

/**
 * A horizontal row that scrolls under the screen gutters with no visible scrollbar: chips, and the
 * card rails («Новинки», «Похожие ароматы»). A swipe that ends there does not hand the scroll on to
 * the page, and a snapping row stops with its first item on the gutter, not on the screen edge.
 */
export const CHIP_ROW =
  '-mx-[var(--gutter)] flex gap-2 overflow-x-auto overscroll-x-contain scroll-px-[var(--gutter)] px-[var(--gutter)] py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

export interface TypeChipOption<V extends string> {
  value: V;
  label: string;
  thumb?: string | null;
  icon?: ReactNode;
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
  // The choice is always fully in the row, a gutter from the edge: a tap on the chip peeking at
  // the edge slides it in, and a link that opens on «Наборы» starts with it in view. Only the row
  // scrolls, never the page; it glides on a change and jumps on the first render.
  const first = useRef(true);
  const index = options.findIndex((o) => o.value === value);
  useEffect(() => {
    const instant = first.current;
    first.current = false;
    const chip = refs.current[index];
    const row = chip?.parentElement;
    if (!chip || !row) return;
    const gutter = parseFloat(getComputedStyle(row).paddingLeft) || 0;
    const left = chip.offsetLeft - row.offsetLeft;
    const right = left + chip.offsetWidth;
    const target =
      left - gutter < row.scrollLeft
        ? left - gutter
        : right + gutter > row.scrollLeft + row.clientWidth
          ? right + gutter - row.clientWidth
          : null;
    if (target !== null) row.scrollTo({ left: target, behavior: instant ? 'instant' : 'smooth' });
  }, [index]);
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
    <div role="radiogroup" aria-label={label} className={CHIP_ROW}>
      {options.map((o, i) => (
        <Chip
          key={o.value}
          role="radio"
          label={o.label}
          thumb={o.thumb ?? null}
          icon={o.icon}
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
