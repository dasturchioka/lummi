import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

interface Thumb {
  x: number;
  w: number;
  /** False for the first placement, so the thumb does not fly in from the left on mount. */
  glide: boolean;
}

/**
 * Two or three options in a Milk Field pill track (RU / UZ, Светлая / Тёмная).
 * `ink` (default): the chosen option is a Graphite pill, as the approved switches.
 * `paper`: the chosen option is a white segment, for in-page filters later.
 * The chosen pill is one element that glides to the new option, so a switch reads as a move.
 */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  tone = 'ink',
}: {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  label?: string;
  labelledBy?: string;
  tone?: 'ink' | 'paper';
}) {
  const track = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const index = options.findIndex((o) => o.value === value);
  const shape = options.map((o) => `${o.value}:${o.label}`).join('|');

  // Measure the chosen option; again whenever the track resizes (fonts arriving, language switch).
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[index];
      if (!el) return;
      const x = el.offsetLeft;
      const w = el.offsetWidth;
      setThumb((p) => (p && p.x === x && p.w === w ? p : { x, w, glide: p !== null && p.w > 0 }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined' || !track.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(track.current);
    return () => ro.disconnect();
  }, [index, shape]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + options.length) % options.length;
    const opt = options[next];
    if (opt) {
      onChange(opt.value);
      refs.current[next]?.focus();
    }
  };

  const on = tone === 'ink' ? 'text-btn-ink' : 'text-ink';
  const thumbFill = tone === 'ink' ? 'bg-btn' : 'bg-card';
  const measured = thumb !== null && thumb.w > 0;

  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className="relative inline-flex gap-0.5 rounded-pill bg-field p-[3px]"
    >
      {measured ? (
        <span
          aria-hidden="true"
          className={`absolute top-[3px] bottom-[3px] left-0 rounded-pill ${thumbFill}`}
          style={{
            width: thumb.w,
            transform: `translateX(${thumb.x}px)`,
            transition: thumb.glide
              ? 'transform 0.25s cubic-bezier(0.23, 1, 0.32, 1), width 0.25s cubic-bezier(0.23, 1, 0.32, 1)'
              : 'none',
          }}
        />
      ) : null}
      {options.map((o, i) => {
        const chosen = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`type-small relative min-h-8 min-w-14 rounded-pill px-3.5 whitespace-nowrap transition-[color,opacity] duration-200 active:opacity-70 ${
              chosen
                ? `font-semibold ${on} ${measured ? '' : thumbFill}`
                : 'font-medium text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
