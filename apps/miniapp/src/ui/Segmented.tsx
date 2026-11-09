import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

/**
 * Two or three options in a Milk Field pill track (RU / UZ, Светлая / Тёмная).
 * `ink` (default): the chosen option is a Graphite pill, as the approved switches.
 * `paper`: the chosen option is a white segment, for in-page filters later.
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
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = tone === 'ink' ? 'bg-btn text-btn-ink' : 'bg-card text-ink';

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

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className="inline-flex gap-0.5 rounded-pill bg-field p-[3px]"
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`type-small min-h-8 min-w-14 rounded-pill px-3.5 font-semibold whitespace-nowrap transition-colors duration-150 ${
              on ? selected : 'text-muted font-medium'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
