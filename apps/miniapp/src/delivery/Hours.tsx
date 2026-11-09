import { Fragment } from 'react';
import { MetaLine } from '../ui/MetaLine';

/**
 * Opening hours as BTS writes them ("Пн-Сб: 09:00-18:00; Вс: выходной; обед 13:00-14:00"): a
 * line breaks only between the parts, never inside a day range or a time range.
 */
export function Hours({ text }: { text: string }) {
  const parts = text
    .replace(/(\d)-(\d)/g, '$1‑$2')
    .split(/;\s*/)
    .filter(Boolean);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? '; ' : null}
      {/* a hand-typed part longer than a line may still wrap */}
      {part.length <= 24 ? <span className="whitespace-nowrap">{part}</span> : part}
    </Fragment>
  ));
}

/** The muted line under a point's address: landmark and hours, whichever exist, joined by « · ». */
export function PointMeta({
  landmark,
  hours,
  className,
}: {
  landmark: string | null;
  hours: string | null;
  className?: string;
}) {
  return (
    <MetaLine className={className} parts={[landmark, hours ? <Hours text={hours} /> : null]} />
  );
}
