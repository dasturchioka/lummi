import type { FragranceListItem } from '@lummi/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useCatalogList } from '../../catalog/queries';
import { photoUrl } from '../../lib/media';
import { usePrefs } from '../../lib/prefs';
import { TypeChips } from '../../ui/Chips';
import { FragranceGrid, GridSkeleton } from '../../ui/FragranceGrid';
import { FragranceListCard } from '../../ui/FragranceListCard';
import { BoxIcon } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';

/** How many cards each Home section shows (layout, not a business rule). */
const POPULAR_COUNT = 6;
const NEW_COUNT = 8;

type Chip = 'all' | 'homme' | 'femme' | 'unisex';
const CHIPS: Chip[] = ['all', 'homme', 'femme', 'unisex'];

/** «Все →» at the end of a section's title line. */
function SeeAll({ search }: { search: { type?: 'homme' | 'femme' | 'unisex'; sort?: 'new' } }) {
  const { t } = usePrefs();
  return (
    <Link
      to="/catalog"
      search={search}
      className="type-small -my-2 flex items-center gap-1 py-2 pl-2 font-medium text-ink"
    >
      {t.home.all}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

/**
 * The dark Discovery set banner. The sets ticket gives it its content and its link; until then it
 * is a quiet placeholder slot with the box icon, so the page keeps its approved rhythm.
 */
export function DiscoveryBanner() {
  const { t } = usePrefs();
  return (
    <section
      data-slot="discovery"
      className="flex items-center gap-4 rounded-card bg-totals p-4 text-totals-ink"
    >
      <div className="min-w-0 flex-1">
        <p className="type-section">{t.home.discoveryTitle}</p>
        <p className="type-body mt-1.5 opacity-80">{t.home.discoveryText}</p>
        <span className="type-badge mt-3 inline-block rounded-pill bg-bar-ink/20 px-2.5 py-1.5">
          {t.home.discoverySoon}
        </span>
      </div>
      <div
        aria-hidden="true"
        className="grid size-16 shrink-0 place-items-center rounded-card bg-bar-ink/15 text-bar-ink"
      >
        <BoxIcon size={28} />
      </div>
    </section>
  );
}

/** «Популярное»: top sales, the type chips filter in place. */
export function Popular() {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const [chip, setChip] = useState<Chip>('all');
  const list = useCatalogList(chip === 'all' ? {} : { type: chip }, POPULAR_COUNT);
  const page = list.data?.pages[0];
  const open = (slug: string) => void navigate({ to: '/p/$slug', params: { slug } });

  // Nothing in the whole catalog: one calm state, not a row of empty sections.
  if (page && page.total === 0 && chip === 'all')
    return (
      <EmptyState icon={<BoxIcon size={28} />} title={t.home.emptyTitle} text={t.home.emptyText} />
    );

  const photos = page?.facets.typePhotos;
  const options = CHIPS.map((c) => ({
    value: c,
    label: t.catalog.types[c],
    thumb: photos?.[c] ? photoUrl(photos[c], 400) : undefined,
  }));

  let body;
  if (!page) {
    body = list.isError ? (
      <ErrorState retrying={list.isFetching} onRetry={() => void list.refetch()} />
    ) : (
      <GridSkeleton count={POPULAR_COUNT} />
    );
  } else if (page.items.length === 0) {
    body = <EmptyState icon={<BoxIcon size={28} />} title={t.catalog.nothingTitle} />;
  } else {
    body = (
      <FragranceGrid
        items={page.items}
        onSelect={open}
        label={t.home.popular}
        busy={list.isPlaceholderData}
      />
    );
  }
  return (
    <section aria-labelledby="home-popular">
      <div className="mb-3 flex items-baseline justify-between gap-3">
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

/** «Новинки»: the new-flagged fragrances in a row; «Все →» is the catalog sorted by new. */
export function Novelties() {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const list = useCatalogList({ isNew: 1, sort: 'new' }, NEW_COUNT);
  const items: FragranceListItem[] | undefined = list.data?.pages[0]?.items;
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
      <ul className="-mx-[var(--gutter)] flex snap-x gap-2 overflow-x-auto overscroll-x-contain px-[var(--gutter)] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items
          ? items.map((it) => (
              <li key={it.slug} className="flex w-[164px] shrink-0 snap-start">
                <FragranceListCard
                  item={it}
                  layout="grid"
                  onSelect={(slug) => void navigate({ to: '/p/$slug', params: { slug } })}
                />
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
