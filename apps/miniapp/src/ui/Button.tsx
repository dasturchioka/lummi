import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { Spinner } from './icons-core';

type Variant = 'primary' | 'secondary' | 'tonal';
type Size = 'md' | 'sm' | 'pair';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Full-width, the usual shape in a dock or a state. */
  block?: boolean;
  /** Busy: keeps its width and colours, shows a spinner, ignores taps. */
  loading?: boolean;
}

/*
 * Press: a quick 0.97 scale on the way down (and a Milk Field wash on secondary), released with
 * the same curve. `data-pressed` forces that look for the component gallery.
 */
const base =
  'type-button relative inline-flex items-center justify-center gap-2 rounded-btn transition-[scale,background-color,color,box-shadow,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] enabled:active:scale-[0.97] data-[pressed]:scale-[0.97] disabled:cursor-default';
const variants: Record<Variant, string> = {
  primary: 'bg-btn text-btn-ink enabled:hover:opacity-90 disabled:bg-field disabled:text-muted',
  secondary:
    'bg-transparent text-ink inset-line enabled:hover:bg-field enabled:active:bg-field data-[pressed]:bg-field disabled:text-muted disabled:shadow-[inset_0_0_0_1px_var(--c-line)]',
  /* The second action beside a primary in a dock («Купить сейчас», approved comp). */
  tonal: 'bg-block text-ink enabled:hover:opacity-90 disabled:bg-field disabled:text-muted',
};
const sizes: Record<Size, string> = {
  md: 'h-12 px-5',
  sm: 'h-9 px-3.5',
  /* 48 px with 14 px sides: two actions sharing one dock row («В корзину» + «Купить сейчас»). */
  pair: 'h-12 px-3.5',
};

/**
 * Primary is Graphite on Milk (inverted in dark); tonal is Stone (Dark Block in dark) with ink text.
 * A disabled button carries the reason as its label.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading = false,
  className = '',
  type = 'button',
  children,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (!loading) onClick?.(e);
      }}
      className={`${base} ${variants[variant]} ${sizes[size]} ${block ? 'w-full' : ''} ${
        loading ? 'pointer-events-none' : ''
      } ${className}`}
      {...rest}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-2">{children}</span>
          <span className="absolute inset-0 grid place-items-center">
            <Spinner size={size === 'sm' ? 16 : 18} />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
