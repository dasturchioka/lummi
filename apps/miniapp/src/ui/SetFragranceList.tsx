import { usePrefs } from '../lib/prefs';
import { attribution } from './FragranceListCard';

/**
 * The five fragrances of a set line, one per row: the name, then «по мотивам <brand>» (the brand
 * rule holds wherever a fragrance is named). Shared by the cart and the order.
 */
export function SetFragranceList({ items }: { items: { name: string; brand: string }[] }) {
  const { t } = usePrefs();
  return (
    <ul className="type-small mt-1 flex flex-col gap-0.5 text-muted" data-testid="set-fragrances">
      {items.map((f, i) => (
        <li key={i} className="text-pretty [overflow-wrap:anywhere]">
          <span className="text-ink">{f.name}</span> {attribution(t.card.basedOn, f.brand)}
        </li>
      ))}
    </ul>
  );
}
