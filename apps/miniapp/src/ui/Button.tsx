import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary';
type Size = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Full-width, the usual shape in a dock or a state. */
  block?: boolean;
}

const base =
  'type-button inline-flex items-center justify-center gap-2 rounded-btn transition-[background-color,color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100';
const variants: Record<Variant, string> = {
  primary: 'bg-btn text-btn-ink disabled:bg-field disabled:text-muted',
  secondary: 'bg-transparent text-ink inset-line disabled:text-muted',
};
const sizes: Record<Size, string> = { md: 'h-12 px-4', sm: 'h-9 px-3.5' };

/** Primary is Graphite on Milk (inverted in dark); a disabled button carries the reason as its label. */
export function Button({
  variant = 'primary',
  size = 'md',
  block,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    />
  );
}
