import type { BtsPointDto, RegionDto } from '@lummi/contracts';
import { POINT_SEARCH_MIN } from '@lummi/contracts';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fill } from '../lib/fill';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { Card, CardList } from '../ui/Card';
import { CheckIcon, ChevronIcon, PinIcon, SearchIcon } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { regionName, useCities, usePoints, useRegions, type Picked } from './queries';

type Step = 'regions' | 'cities' | 'points' | 'typed';

export interface DeliveryPickerProps {
  /** `city`: region then city (Home's delivery city). `point`: region, city, then a BTS point (checkout). */
  mode: 'city' | 'point';
  /** Opens on this region and city when set (the saved delivery city). */
  initial?: { regionId: number; city: string } | null;
  /** The point already chosen, marked in the list. */
  selectedPointId?: number;
  onPick: (picked: Picked) => void;
  /** The pick is being saved: rows stay, taps are ignored. */
  busy?: boolean;
  error?: string | null;
}

const FIELD =
  'h-11 w-full rounded-btn bg-field pr-3 pl-10 text-base text-ink placeholder:text-muted outline-none transition-shadow focus-visible:shadow-[inset_0_0_0_1.5px_var(--c-ink)]';

/** Waits for the typing to settle so a search is not sent per keystroke. */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function List({ children }: { children: ReactNode }) {
  return <CardList>{children}</CardList>;
}

function Loading() {
  return (
    <Card className="space-y-px overflow-hidden p-0" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex min-h-14 items-center px-4">
          <Skeleton className="h-4 w-44" />
        </div>
      ))}
    </Card>
  );
}

function PointRow({
  point,
  selected,
  context,
  onClick,
}: {
  point: BtsPointDto;
  selected: boolean;
  context?: string;
  onClick: () => void;
}) {
  const { t } = usePrefs();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid="point-row"
      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-field active:bg-field"
    >
      <span className="mt-0.5 shrink-0 text-sage-ink">
        <PinIcon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        {context ? <span className="type-small mb-0.5 block text-muted">{context}</span> : null}
        <span className="type-body block text-[15px] font-semibold [overflow-wrap:anywhere]">
          {point.name}
        </span>
        <span className="type-body mt-0.5 block text-[14px] [overflow-wrap:anywhere]">
          {point.address}
        </span>
        {point.landmark ? (
          <span className="type-small mt-0.5 block text-muted [overflow-wrap:anywhere]">
            {fill(t.delivery.landmark, { text: point.landmark })}
          </span>
        ) : null}
        {point.hours ? (
          <span className="type-small mt-0.5 block text-muted">
            {/* a time range never breaks across lines */}
            {point.hours.replace(/(\d)-(\d)/g, '$1\u2011$2')}
          </span>
        ) : null}
      </span>
      {selected ? (
        <span className="mt-0.5 shrink-0 text-ink" role="img" aria-label={t.delivery.selected}>
          <CheckIcon size={20} />
        </span>
      ) : null}
    </button>
  );
}

/**
 * Region -> city/district -> BTS point, with a search across all points, address, landmark and
 * hours on every point, and «Не нашёл свой пункт» falling back to region + free text (flagged as
 * typed). `mode="city"` stops one step earlier: it is the Home delivery city, a place and never a
 * price. Built standalone for a Sheet or a screen; checkout embeds the `point` mode.
 */
export function DeliveryPicker({
  mode,
  initial,
  selectedPointId,
  onPick,
  busy = false,
  error,
}: DeliveryPickerProps) {
  const { t, language } = usePrefs();
  const regions = useRegions();
  const [regionId, setRegionId] = useState<number | undefined>(initial?.regionId);
  const [city, setCity] = useState<string | undefined>(initial?.city);
  const [step, setStep] = useState<Step>(
    initial ? (mode === 'point' ? 'points' : 'cities') : 'regions',
  );
  const [query, setQuery] = useState('');
  const [typedText, setTypedText] = useState('');
  const [typedRegionId, setTypedRegionId] = useState<number | undefined>(initial?.regionId);

  const region: RegionDto | undefined = regions.data?.find((r) => r.id === regionId);
  const name = (r: RegionDto) => regionName(r, language);
  const q = query.trim();
  const searching = mode === 'point' && step !== 'typed' && q.length >= POINT_SEARCH_MIN;
  const debounced = useDebounced(q);
  const cities = useCities(step === 'cities' || step === 'points' ? regionId : undefined);
  const points = usePoints(
    { regionId, city },
    mode === 'point' && step === 'points' && regionId !== undefined && city !== undefined,
  );
  const found = usePoints({ q: debounced }, searching && debounced.length >= POINT_SEARCH_MIN);

  const shownCities = useMemo(() => {
    const all = cities.data ?? [];
    if (mode !== 'city' || !q) return all;
    const needle = q.toLowerCase().replaceAll('ё', 'е');
    return all.filter((c) => c.city.toLowerCase().replaceAll('ё', 'е').includes(needle));
  }, [cities.data, mode, q]);

  const go = (next: Step) => {
    setStep(next);
    setQuery('');
  };
  const back = () => {
    if (step === 'typed') return go(city ? 'points' : regionId ? 'cities' : 'regions');
    if (step === 'points') return go('cities');
    setCity(undefined);
    go('regions');
  };
  const pickRegion = (r: RegionDto) => {
    setRegionId(r.id);
    setTypedRegionId(r.id);
    setCity(undefined);
    go('cities');
  };
  const pickCity = (c: string) => {
    if (busy || !region) return;
    setCity(c);
    if (mode === 'city') return onPick({ kind: 'city', region, city: c });
    go('points');
  };
  const pickPoint = (point: BtsPointDto) => {
    if (busy) return;
    const r = regions.data?.find((x) => x.id === point.regionId);
    if (r) onPick({ kind: 'point', region: r, point });
  };

  const notFoundLink = mode === 'point' && (step === 'points' || searching || step === 'cities');
  const typedRegion = regions.data?.find((r) => r.id === typedRegionId);
  const canSubmitTyped = !!typedRegion && typedText.trim().length >= 3;

  let body: ReactNode;
  if (regions.isError) {
    body = <ErrorState onRetry={() => void regions.refetch()} retrying={regions.isFetching} />;
  } else if (regions.isPending) {
    body = <Loading />;
  } else if (step === 'typed') {
    body = (
      <form
        className="space-y-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmitTyped && typedRegion) {
            onPick({ kind: 'typed', region: typedRegion, text: typedText.trim() });
          }
        }}
      >
        <p className="type-body text-muted">{t.delivery.typedText}</p>
        <label className="block">
          <span className="type-small mb-1 block text-muted">{t.delivery.typedRegion}</span>
          <select
            value={typedRegionId ?? ''}
            onChange={(e) => setTypedRegionId(Number(e.target.value) || undefined)}
            className="h-11 w-full rounded-btn bg-field px-3 text-base text-ink outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--c-ink)]"
          >
            <option value="" disabled />
            {regions.data.map((r) => (
              <option key={r.id} value={r.id}>
                {name(r)}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={typedText}
          onChange={(e) => setTypedText(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder={t.delivery.typedPlaceholder}
          aria-label={t.delivery.typedTitle}
          className="w-full resize-none rounded-btn bg-field px-3 py-3 text-base text-ink placeholder:text-muted outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--c-ink)]"
        />
        <Button type="submit" block disabled={!canSubmitTyped} loading={busy}>
          {canSubmitTyped ? t.delivery.typedSubmit : t.delivery.typedTooShort}
        </Button>
      </form>
    );
  } else if (searching) {
    const stale = debounced !== q || found.isFetching;
    body = found.isError ? (
      <ErrorState onRetry={() => void found.refetch()} retrying={found.isFetching} />
    ) : !found.data || (stale && found.isPending) ? (
      <Loading />
    ) : found.data.length === 0 ? (
      <EmptyState
        icon={<SearchIcon size={28} />}
        title={t.delivery.noResultsTitle}
        text={t.delivery.noResultsText}
      />
    ) : (
      <List>
        {found.data.map((p) => {
          const r = regions.data.find((x) => x.id === p.regionId);
          return (
            <PointRow
              key={p.id}
              point={p}
              selected={p.id === selectedPointId}
              context={r ? `${name(r)} · ${p.city}` : p.city}
              onClick={() => pickPoint(p)}
            />
          );
        })}
      </List>
    );
  } else if (step === 'regions') {
    body = (
      <List>
        {regions.data.map((r) => (
          <button
            key={r.id}
            type="button"
            data-testid="region-row"
            onClick={() => pickRegion(r)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-field active:bg-field"
          >
            <span className="type-body min-w-0 flex-1 text-[15px]">{name(r)}</span>
            <span className="shrink-0 text-muted">
              <ChevronIcon size={18} />
            </span>
          </button>
        ))}
      </List>
    );
  } else if (step === 'cities') {
    body = cities.isError ? (
      <ErrorState onRetry={() => void cities.refetch()} retrying={cities.isFetching} />
    ) : cities.isPending ? (
      <Loading />
    ) : cities.data.length === 0 ? (
      <EmptyState
        icon={<PinIcon size={28} />}
        title={t.delivery.noCitiesTitle}
        text={t.delivery.noCitiesText}
      />
    ) : shownCities.length === 0 ? (
      <EmptyState
        icon={<SearchIcon size={28} />}
        title={t.delivery.noResultsTitle}
        text={t.delivery.noResultsText}
      />
    ) : (
      <List>
        {shownCities.map((c) => (
          <button
            key={c.city}
            type="button"
            data-testid="city-row"
            onClick={() => pickCity(c.city)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-field active:bg-field"
          >
            <span className="min-w-0 flex-1">
              <span className="type-body block text-[15px] [overflow-wrap:anywhere]">{c.city}</span>
              {mode === 'point' ? (
                <span className="type-small block text-muted">
                  {fill(t.delivery.pointsCount, { n: c.pointCount })}
                </span>
              ) : null}
            </span>
            {mode === 'city' && c.city === initial?.city && regionId === initial.regionId ? (
              <span className="shrink-0 text-ink" role="img" aria-label={t.delivery.selected}>
                <CheckIcon size={20} />
              </span>
            ) : (
              <span className="shrink-0 text-muted">
                <ChevronIcon size={18} />
              </span>
            )}
          </button>
        ))}
      </List>
    );
  } else {
    body = points.isError ? (
      <ErrorState onRetry={() => void points.refetch()} retrying={points.isFetching} />
    ) : points.isPending ? (
      <Loading />
    ) : (
      <List>
        {points.data.map((p) => (
          <PointRow
            key={p.id}
            point={p}
            selected={p.id === selectedPointId}
            onClick={() => pickPoint(p)}
          />
        ))}
      </List>
    );
  }

  const heading =
    step === 'typed'
      ? t.delivery.typedTitle
      : step === 'cities'
        ? region
          ? name(region)
          : t.delivery.cities
        : step === 'points'
          ? `${city ?? ''}`
          : null;
  const showSearch = step !== 'typed' && (mode === 'point' || step === 'cities');

  return (
    <div className="pb-2">
      {showSearch || heading ? (
        <div className="sticky top-0 z-10 -mx-4 bg-ground px-4 pt-1 pb-3">
          {heading ? (
            <div className="mb-2 flex min-h-11 items-center gap-1">
              <button
                type="button"
                onClick={back}
                aria-label={t.delivery.back}
                className="-ml-2 grid size-11 shrink-0 place-items-center rounded-pill text-ink transition-[background-color,transform] duration-150 hover:bg-field active:scale-95 active:bg-field"
              >
                <span className="rotate-180">
                  <ChevronIcon size={20} />
                </span>
              </button>
              <p className="type-heading min-w-0 [overflow-wrap:anywhere]">{heading}</p>
            </div>
          ) : null}
          {showSearch ? (
            <label className="relative block">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
                <SearchIcon size={20} />
              </span>
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={mode === 'point' ? t.delivery.searchPoints : t.delivery.searchCities}
                aria-label={mode === 'point' ? t.delivery.searchPoints : t.delivery.searchCities}
                className={FIELD}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="type-small mb-2 text-ink">
          {error}
        </p>
      ) : null}
      <div aria-busy={busy || undefined} className={busy ? 'pointer-events-none opacity-60' : ''}>
        {body}
      </div>
      {notFoundLink ? (
        <div className="mt-3">
          <Button variant="secondary" block onClick={() => go('typed')}>
            {t.delivery.notFound}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
