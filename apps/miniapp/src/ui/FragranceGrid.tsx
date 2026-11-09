import type { FragranceListItem } from '@lummi/contracts';
import { FragranceListCard } from './FragranceListCard';

/** The two-column list of `FragranceListCard` (catalog, «Популярное»): equal-height rows. */
export function FragranceGrid({
  items,
  onSelect,
  label,
  busy = false,
}: {
  items: FragranceListItem[];
  onSelect: (slug: string) => void;
  label: string;
  busy?: boolean;
}) {
  return (
    <ul
      aria-label={label}
      aria-busy={busy || undefined}
      className={`grid grid-cols-2 gap-2 transition-opacity duration-150 ${busy ? 'opacity-60' : ''}`}
    >
      {items.map((it) => (
        <li key={it.slug} className="flex *:min-w-0 *:flex-1">
          <FragranceListCard item={it} layout="grid" onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
