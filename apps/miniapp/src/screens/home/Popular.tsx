import { useState } from 'react';
import type { FragranceType } from '../../catalog/filters';
import { useCatalogPage } from '../../catalog/queries';
import { typeChipOptions } from '../../catalog/typeChips';
import { useOpenFragrance } from '../../lib/navigation';
import { usePrefs } from '../../lib/prefs';
import { TypeChips } from '../../ui/Chips';
import { FragranceGrid } from '../../ui/FragranceGrid';
import { GridSkeleton } from '../../ui/GridSkeleton';
import { BottleIcon } from '../../ui/icons';
import { EmptyState, ErrorState } from '../../ui/States';
import { SeeAll } from './SeeAll';

/** How many cards «Популярное» shows (layout, not a business rule). */
export const POPULAR_COUNT = 6;

type TypeFilter = 'all' | FragranceType;
const TYPE_FILTERS: TypeFilter[] = ['all', 'homme', 'femme', 'unisex'];

/** «Популярное»: top sales, the type chips filter in place. */
export default function Popular() {
  const { t } = usePrefs();
  const open = useOpenFragrance();
  const [chip, setChip] = useState<TypeFilter>('all');
  const list = useCatalogPage(chip === 'all' ? {} : { type: chip }, POPULAR_COUNT);
  const page = list.data;

  // Nothing in the whole catalog: one calm state, not a row of empty sections.
  if (page && page.total === 0 && chip === 'all')
    return (
      <EmptyState
        icon={<BottleIcon size={28} />}
        title={t.home.emptyTitle}
        text={t.home.emptyText}
      />
    );

  const options = typeChipOptions(TYPE_FILTERS, t.catalog.types, page?.facets.typePhotos);

  let body;
  if (!page) {
    body = list.isError ? (
      <ErrorState retrying={list.isFetching} onRetry={() => void list.refetch()} />
    ) : (
      <GridSkeleton count={POPULAR_COUNT} />
    );
  } else if (page.items.length === 0) {
    body = <EmptyState icon={<BottleIcon size={28} />} title={t.catalog.nothingTitle} />;
  } else {
    body = (
      <FragranceGrid
        // «Популярное» is the top sellers: its title already says ХИТ, so the cards drop that badge (DESIGN.md Badges).
        items={page.items.map((it) => ({ ...it, isHit: false }))}
        onSelect={open}
        label={t.home.popular}
        busy={list.isPlaceholderData}
      />
    );
  }
  return (
    <section aria-labelledby="home-popular">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-popular" className="type-section text-ink">
          {t.home.popular}
        </h2>
        <SeeAll search={chip === 'all' ? {} : { type: chip }} />
      </div>
      <TypeChips options={options} value={chip} onChange={setChip} label={t.home.filterLabel} />
      <div className="mt-3">{body}</div>
    </section>
  );
}
