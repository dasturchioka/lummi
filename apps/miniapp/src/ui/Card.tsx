import type { ElementType, HTMLAttributes, ReactNode } from 'react';

/** White card on Milk (Graphite in dark), 12 px radius, no shadow: depth is tone and hairlines. */
export function Card({
  as: Tag = 'div',
  className = '',
  ...rest
}: { as?: ElementType } & HTMLAttributes<HTMLElement>) {
  return <Tag className={`rounded-card bg-card text-ink ${className}`} {...rest} />;
}

/** A card of rows separated by hairlines. */
export function CardList({ children }: { children: ReactNode }) {
  return <Card className="divide-y divide-line overflow-hidden">{children}</Card>;
}

/**
 * One row of a CardList: an optional 20 px icon, the label (+ hint), then any control or value.
 * A row with `onClick` is a button and washes to Milk Field while pressed (`pressed` forces that
 * look for the component gallery).
 */
export function ListRow({
  label,
  hint,
  leading,
  trailing,
  onClick,
  pressed,
  id,
}: {
  label: ReactNode;
  hint?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  id?: string;
}) {
  const body = (
    <>
      {leading ? <span className="-ml-0.5 shrink-0 text-ink">{leading}</span> : null}
      <span className="min-w-0 flex-1 text-left">
        <span id={id} className="type-body block text-[15px] text-ink">
          {label}
        </span>
        {hint ? <span className="type-small mt-0.5 block text-muted">{hint}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center text-muted">{trailing}</span> : null}
    </>
  );
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-2.5';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      data-pressed={pressed || undefined}
      className={`${cls} transition-colors duration-150 hover:bg-field active:bg-field data-[pressed]:bg-field`}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
