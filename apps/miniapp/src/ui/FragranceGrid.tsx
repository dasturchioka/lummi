import type { FragranceListItem } from '@lummi/contracts';
import { FragranceListCard } from './FragranceListCard';
import { Skeleton } from './Skeleton';

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

/** The grid card's shape while the list loads: photo, lockup, price. */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col rounded-card bg-card p-2 pb-3">
          <Skeleton className="aspect-[3/4] w-full" rounded="photo" />
          <div className="px-1 pt-2.5">
            <Skeleton className="h-2.5 w-3/4" rounded="pill" />
            <Skeleton className="mt-2 h-5 w-3/5" />
            <Skeleton className="mt-3 h-3 w-2/5" />
            <Skeleton className="mt-6 h-3.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
