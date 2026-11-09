import { useCatalogPage } from '../../catalog/queries';
import { useOpenFragrance } from '../../lib/navigation';
import { usePrefs } from '../../lib/prefs';
import { CHIP_ROW } from '../../ui/Chips';
import { FragranceListCard } from '../../ui/FragranceListCard';
import { Skeleton } from '../../ui/Skeleton';
import { SeeAll } from './SeeAll';

/** How many cards the row shows (layout, not a business rule). */
const NEW_COUNT = 8;

/** «Новинки»: the new-flagged fragrances in a row; «Все →» is the catalog sorted by new. */
export default function Novelties() {
  const { t } = usePrefs();
  const open = useOpenFragrance();
  const list = useCatalogPage({ isNew: 1, sort: 'new' }, NEW_COUNT);
  const items = list.data?.items;
  // A failed or empty row simply is not there; the sections above carry the page.
  if (list.isError || (items && items.length === 0)) return null;
  return (
    <section aria-labelledby="home-new">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="home-new" className="type-section text-ink">
          {t.home.news}
        </h2>
        <SeeAll search={{ sort: 'new' }} />
      </div>
      <ul className={`${CHIP_ROW} snap-x pb-1`}>
        {items
          ? items.map((it) => (
              <li key={it.slug} className="flex w-[164px] shrink-0 snap-start">
                <FragranceListCard item={it} layout="grid" onSelect={open} />
              </li>
            ))
          : [0, 1, 2].map((i) => (
              <li key={i} aria-hidden="true" className="w-[164px] shrink-0">
                <Skeleton className="aspect-[3/4] w-full" rounded="card" />
                <Skeleton className="mt-3 h-4 w-3/4" />
              </li>
            ))}
      </ul>
    </section>
  );
}
