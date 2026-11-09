import { fill, formatMoney } from '@lummi/i18n';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';
import { activeFilterCount, type CatalogSearch } from '../catalog/filters';
import { useCatalogList } from '../catalog/queries';
import type { SheetName } from '../catalog/CatalogSheets';
import { photoUrl } from '../lib/media';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { CHIP_ROW, Chip, TypeChips } from '../ui/Chips';
import { FragranceGrid, GridSkeleton } from '../ui/FragranceGrid';
import { BoxIcon, ChevronIcon, SearchIcon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { SearchField } from '../ui/SearchField';
import { EmptyState, ErrorState } from '../ui/States';

const CatalogSheets = lazy(() => import('../catalog/CatalogSheets'));

type TypeValue = 'all' | 'homme' | 'femme' | 'unisex' | 'sets';
const TYPES: TypeValue[] = ['all', 'homme', 'femme', 'unisex', 'sets'];

const chevron = (
  <span aria-hidden="true" className="-mr-1 rotate-90">
    <ChevronIcon size={14} />
  </span>
);

/**
 * `/catalog`: the search field, the photo-circle type chips (both stay under the top edge), then
 * the four filter chips, the sort with «Найдено: N», and the two-column grid. The state lives in
 * the URL, so a way back from a fragrance card keeps the filters and the scroll.
 */
export function Catalog() {
  const { t, language } = usePrefs();
  const navigate = useNavigate();
  const filters: CatalogSearch = useSearch({ strict: false });
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [sheetMounted, setSheetMounted] = useState(false);

  const sets = filters.type === 'sets';
  const list = useCatalogList(filters, undefined, !sets);
  const first = list.data?.pages[0];
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const facets = first?.facets;

  const change = (patch: Partial<CatalogSearch>) =>
    void navigate({
      to: '/catalog',
      search: (prev: CatalogSearch) => {
        const next = { ...prev, ...patch };
        for (const k of Object.keys(next) as (keyof CatalogSearch)[])
          if (next[k] === undefined) delete next[k];
        return next;
      },
      replace: true,
    });
  const reset = () =>
    void navigate({
      to: '/catalog',
      search: (prev: CatalogSearch) => (prev.sort ? { sort: prev.sort } : {}),
      replace: true,
    });
  const openSheet = (name: SheetName) => {
    setSheetMounted(true);
    setSheet(name);
  };

  const typeOptions = TYPES.map((v) => ({
    value: v,
    label: t.catalog.types[v],
    thumb: v !== 'sets' && facets?.typePhotos[v] ? photoUrl(facets.typePhotos[v], 400) : undefined,
  }));

  const familyName = facets?.families.find((f) => f.id === filters.family)?.name[language];
  const priceLabel =
    filters.min !== undefined && filters.max !== undefined
      ? fill(t.catalog.priceRange, {
          from: formatMoney(filters.min, language),
          to: formatMoney(filters.max, language),
        })
      : filters.min !== undefined
        ? fill(t.catalog.priceAtLeast, { from: formatMoney(filters.min, language) })
        : filters.max !== undefined
          ? fill(t.catalog.priceAtMost, { to: formatMoney(filters.max, language) })
          : undefined;
  const filterChips: { name: SheetName; label: string; value: string | undefined }[] = [
    { name: 'family', label: t.catalog.filters.family, value: familyName },
    {
      name: 'volume',
      label: t.catalog.filters.volume,
      value: filters.volume ? `${filters.volume} ${t.card.ml}` : undefined,
    },
    { name: 'price', label: t.catalog.filters.price, value: priceLabel },
    {
      name: 'season',
      label: t.catalog.filters.season,
      value: filters.season ? t.card.season[filters.season] : undefined,
    },
  ];

  let body;
  if (sets) {
    body = (
      <EmptyState
        icon={<BoxIcon size={28} />}
        title={t.catalog.setsTitle}
        text={t.catalog.setsText}
      />
    );
  } else if (!first) {
    body = list.isError ? (
      <ErrorState retrying={list.isFetching} onRetry={() => void list.refetch()} />
    ) : (
      <GridSkeleton />
    );
  } else if (first.total === 0) {
    const filtered = activeFilterCount(filters) > 0 || filters.type !== undefined;
    body = filtered ? (
      <EmptyState
        icon={<SearchIcon size={28} />}
        title={t.catalog.nothingTitle}
        text={t.catalog.nothingText}
        action={
          <Button variant="secondary" block onClick={reset}>
            {t.catalog.resetFilters}
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<BoxIcon size={28} />}
        title={t.catalog.emptyTitle}
        text={t.catalog.emptyText}
      />
    );
  } else {
    body = (
      <>
        <FragranceGrid
          items={items}
          label={t.catalog.title}
          busy={list.isPlaceholderData}
          onSelect={(slug) => void navigate({ to: '/p/$slug', params: { slug } })}
        />
        {list.hasNextPage ? (
          <Button
            variant="secondary"
            block
            className="mt-4"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t.catalog.showMore}
          </Button>
        ) : null}
        {list.isError && !list.isFetchingNextPage ? (
          <ErrorState retrying={list.isFetching} onRetry={() => void list.fetchNextPage()} />
        ) : null}
      </>
    );
  }

  return (
    <Screen
      header={
        <div className="flex flex-col gap-3 pt-4 pb-3">
          <SearchField />
          <TypeChips
            options={typeOptions}
            value={filters.type ?? 'all'}
            onChange={(v) => change({ type: v === 'all' ? undefined : v })}
            label={t.catalog.typeLabel}
          />
        </div>
      }
    >
      {sets ? null : (
        <>
          <div className={`${CHIP_ROW} mt-3`}>
            {filterChips.map((c) => (
              <Chip
                key={c.name}
                label={c.value ?? c.label}
                selected={c.value !== undefined}
                trailing={chevron}
                onClick={() => openSheet(c.name)}
              />
            ))}
          </div>
          <div className="mt-3 mb-3 flex min-h-11 items-center justify-between gap-3">
            <p className="type-small text-muted" aria-live="polite">
              {first ? fill(t.catalog.found, { n: String(first.total) }) : ' '}
            </p>
            <button
              type="button"
              onClick={() => openSheet('sort')}
              className="type-small -mr-2 flex min-h-11 items-center gap-1 pr-2 pl-3 font-medium text-ink"
            >
              {t.catalog.sort[filters.sort ?? 'top']}
              <span aria-hidden="true" className="rotate-90">
                <ChevronIcon size={14} />
              </span>
            </button>
          </div>
        </>
      )}
      {body}
      {sheetMounted ? (
        <Suspense fallback={null}>
          <CatalogSheets
            open={sheet}
            onClose={() => setSheet(null)}
            filters={filters}
            onChange={change}
            families={facets?.families ?? []}
            priceBounds={facets?.price ?? null}
          />
        </Suspense>
      ) : null}
    </Screen>
  );
}
