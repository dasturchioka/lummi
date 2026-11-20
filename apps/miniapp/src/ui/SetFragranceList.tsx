import { usePrefs } from '../lib/prefs';
import { attribution } from './attribution';

/**
 * The five fragrances of a set line, one per row: the name, then «по мотивам <brand>» (the brand
 * rule holds wherever a fragrance is named). Shared by the cart and the order.
 */
export function SetFragranceList({
  items,
  muted = false,
}: {
  items: { name: string; brand: string }[];
  /** A sold-out line: the names step back with the rest of the row. */
  muted?: boolean;
}) {
  const { t } = usePrefs();
  return (
    <ul className="type-small mt-1.5 flex flex-col gap-1 text-muted" data-testid="set-fragrances">
      {items.map((f, i) => (
        // a hanging indent: a name that wraps stays one item, not two
        <li key={i} className="pl-2.5 -indent-2.5 text-pretty [overflow-wrap:anywhere]">
          <span className={muted ? undefined : 'text-ink'}>{f.name}</span>{' '}
          {attribution(t.card.basedOn, f.brand)}
        </li>
      ))}
    </ul>
  );
}
