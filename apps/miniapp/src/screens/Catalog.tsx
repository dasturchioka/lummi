import { fill, formatMoney } from '@lummi/i18n';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { CatalogSearch, FragranceType } from '../catalog/filters';
import { activeFilterCount } from '../catalog/request';
import { useCatalogList } from '../catalog/infinite';
import { typeChipOptions } from '../catalog/typeChips';
import type { SheetName } from '../catalog/CatalogSheets';
import { useOpenFragrance } from '../lib/navigation';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { CHIP_ROW, Chip, TypeChips } from '../ui/Chips';
import { FragranceGrid } from '../ui/FragranceGrid';
import { GridSkeleton } from '../ui/GridSkeleton';
import { BoxIcon, ChevronIcon, GridIcon, SearchIcon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { SearchField } from '../ui/SearchField';
import { EmptyState, ErrorState } from '../ui/States';

const CatalogSheets = lazy(() => import('../catalog/CatalogSheets'));

type TypeValue = 'all' | FragranceType | 'sets';
const TYPES: TypeValue[] = ['all', 'homme', 'femme', 'unisex', 'sets'];

const chevron = (
  <span aria-hidden="true" className="-mr-1 rotate-90">
    <ChevronIcon size={14} />
  </span>
);

/**
 * `/catalog`: the title, the search field and the photo-circle type chips (these two stay under the
 * top edge once the title has scrolled away), then the four filter chips, the sort with
 * «Найдено: N», and the two-column grid. The state lives in the URL, so a way back from a
 * fragrance card keeps the filters and the scroll.
 */
export function Catalog() {
  const { t, language } = usePrefs();
  const navigate = useNavigate();
  const open = useOpenFragrance();
  const filters: CatalogSearch = useSearch({ strict: false });
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [sheetMounted, setSheetMounted] = useState(false);

  const sets = filters.type === 'sets';
  const list = useCatalogList(filters, !sets);
  const first = list.data?.pages[0];
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  // Cards already on screen (or there when the screen opened) stay still; only a page that
  // «Показать ещё» added to the same list settles into place. A new filter is a new first page.
  const pages = list.data?.pages;
  const shown = useRef<{ first: unknown; count: number } | null>(null);
  const appearFrom =
    shown.current && pages?.[0] === shown.current.first && items.length > shown.current.count
      ? shown.current.count
      : undefined;
  useEffect(() => {
    shown.current = pages ? { first: pages[0], count: items.length } : null;
  });
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

  // «Наборы» has no bottle of its own: the box icon holds its circle until the sets ticket.
  const typeOptions = typeChipOptions(TYPES, t.catalog.types, facets?.typePhotos).map((o) =>
    o.value === 'sets' ? { ...o, icon: <BoxIcon size={16} /> } : o,
  );

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
        icon={<GridIcon size={28} />}
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
          onSelect={open}
          appearFrom={appearFrom}
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
      lead={
        // The title's own 16 px under it, less the 8 px the stuck header keeps above the field.
        <div className="-mb-2">
          <ScreenHeader title={t.catalog.title} />
        </div>
      }
      header={
        <div className="flex flex-col gap-3 pt-2 pb-3">
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
          <div className={`${CHIP_ROW} mt-1`}>
            {filterChips.map((c) => (
              <Chip
                key={c.name}
                variant="filter"
                label={c.value ?? c.label}
                selected={c.value !== undefined}
                trailing={chevron}
                onClick={() => openSheet(c.name)}
              />
            ))}
          </div>
          <div className="my-1 flex min-h-11 items-center justify-between gap-3">
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
