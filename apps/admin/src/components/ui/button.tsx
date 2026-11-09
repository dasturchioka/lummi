import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * DESIGN.md buttons: Graphite fill with Milk text (primary), a hairline-strong inset outline
 * (secondary), Milk Field with Muted Ink when disabled. No red "danger" button: a destructive
 * action is a plain button whose confirmation dialog names the consequence.
 */
const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-button font-semibold',
    // press feedback: 0.97 on the brand ease-out (Tailwind's `ease-out` is themed to it)
    'transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97]',
    'disabled:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-graphite/88 disabled:not-aria-busy:bg-field disabled:not-aria-busy:text-muted-foreground',
        outline:
          'text-foreground shadow-[inset_0_0_0_1px_var(--hairline-strong)] hover:bg-field disabled:not-aria-busy:text-muted-foreground disabled:not-aria-busy:shadow-[inset_0_0_0_1px_var(--hairline)]',
        ghost: 'text-foreground hover:bg-field disabled:not-aria-busy:text-muted-foreground',
      },
      size: {
        default: 'h-11 px-4 text-[15px]',
        sm: 'h-9 px-3 text-[13.5px] [&_svg]:size-4',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Keeps the label (no width jump) and lays a spinner over it; also disables the button. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible contents">{children}</span>
          <span className="absolute inset-0 grid place-items-center">
            <LoaderCircle
              className="animate-[spin_0.7s_linear_infinite] motion-reduce:animate-none"
              aria-hidden
            />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
