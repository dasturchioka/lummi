import type { FragranceListItem } from '@lummi/contracts';
import { FragranceListCard } from './FragranceListCard';

/**
 * The two-column list of `FragranceListCard` (catalog, «Популярное»): equal-height rows.
 * `appearFrom`: cards from this index on have just been added («Показать ещё») and settle in, a
 * row at a time, rather than popping into the space the button left.
 */
export function FragranceGrid({
  items,
  onSelect,
  label,
  busy = false,
  appearFrom,
}: {
  items: FragranceListItem[];
  onSelect: (slug: string) => void;
  label: string;
  busy?: boolean;
  appearFrom?: number;
}) {
  return (
    <ul
      aria-label={label}
      aria-busy={busy || undefined}
      className={`grid grid-cols-2 gap-2 transition-opacity duration-150 ${busy ? 'opacity-60' : ''}`}
    >
      {items.map((it, i) => (
        <li
          key={it.slug}
          className="flex *:min-w-0 *:flex-1"
          style={
            appearFrom !== undefined && i >= appearFrom
              ? {
                  animation: `rise-in 0.32s cubic-bezier(0.23, 1, 0.32, 1) ${Math.min(Math.floor((i - appearFrom) / 2), 3) * 50}ms backwards`,
                }
              : undefined
          }
        >
          <FragranceListCard item={it} layout="grid" onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
