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

/** One row of a CardList: label (+ hint) on the left, any control or value on the right. */
export function ListRow({
  label,
  hint,
  trailing,
  onClick,
  id,
}: {
  label: ReactNode;
  hint?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  id?: string;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span id={id} className="type-body block text-ink">
          {label}
        </span>
        {hint ? <span className="type-small block text-muted">{hint}</span> : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </>
  );
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-2.5';
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
