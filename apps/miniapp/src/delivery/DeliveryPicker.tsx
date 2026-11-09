import type { BtsPointDto, RegionDto } from '@lummi/contracts';
import { POINT_SEARCH_MIN } from '@lummi/contracts';
import { plural } from '@lummi/i18n';
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { Card, CardList } from '../ui/Card';
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  PinIcon,
  SearchIcon,
  Spinner,
} from '../ui/icons';
import { MetaLine } from '../ui/MetaLine';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { PointMeta } from './Hours';
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

/*
 * Milk Field, borderless, 16 px text (no iOS zoom). Focus is the global 2 px Sage outline at a
 * 2 px offset (DESIGN.md); a Graphite outline would read as "selected".
 */
const FIELD_BASE = 'w-full rounded-btn bg-field text-base text-ink placeholder:text-muted';
/*
 * No iOS search-field chrome, and the browser's own clear (a blue ✕ in WebKit) is hidden: ours is
 * drawn in the brand ink.
 */
const SEARCH = `${FIELD_BASE} h-12 appearance-none pl-10 text-ellipsis [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none`;
const LABEL = 'type-small mb-1.5 block font-medium text-muted';
const ROW =
  'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150';
/*
 * Rows wash to Milk Field while pressed. The saved choice rests on Sage Wash with a Sage Ink
 * check: the one row that is already yours (DESIGN.md: Sage confirms).
 */
const rowTone = (selected: boolean) =>
  selected ? 'bg-sage-wash' : 'hover:bg-field active:bg-field';

/** Waits for the typing to settle so a search is not sent per keystroke. */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Scrolls the nearest scrolling box (the sheet body, or the page) so `el` sits at the top of it
 * (only when it is above) or in its middle. Never the page behind a sheet.
 */
function scrollWithin(el: HTMLElement, at: 'top' | 'center') {
  let box = el.parentElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  const r = el.getBoundingClientRect();
  const top = box ? box.getBoundingClientRect().top : 0;
  const height = box ? box.clientHeight : window.innerHeight;
  const delta = at === 'top' ? Math.min(0, r.top - top) : r.top + r.height / 2 - (top + height / 2);
  if (!delta) return;
  if (box) box.scrollTop += delta;
  else window.scrollBy(0, delta);
}

function List({ children }: { children: ReactNode }) {
  return <CardList>{children}</CardList>;
}

/** Placeholder rows shaped like what will load: one line for regions and cities, a point's name and address for points. */
function Loading({ points = false }: { points?: boolean }) {
  return (
    <Card className="divide-y divide-line overflow-hidden" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) =>
        points ? (
          <div key={i} className="space-y-2 px-4 py-3.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-52" />
            <Skeleton className="h-3 w-44" />
          </div>
        ) : (
          <div key={i} className="flex min-h-14 items-center px-4">
            <Skeleton className="h-4 w-44" />
          </div>
        ),
      )}
    </Card>
  );
}

function PointRow({
  point,
  selected,
  context,
  onClick,
  ref,
}: {
  point: BtsPointDto;
  selected: boolean;
  /** Where the point is (search results across regions): region, city. */
  context?: string[];
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { t } = usePrefs();
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid="point-row"
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ${rowTone(selected)}`}
    >
      {/* name / address / landmark · hours: three lines, the shape checkout embeds */}
      <span className="min-w-0 flex-1">
        {context ? <MetaLine className="type-small mb-0.5 text-muted" parts={context} /> : null}
        <span className="type-row block font-semibold break-words">{point.name}</span>
        <span className="type-body block break-words">{point.address}</span>
        <PointMeta
          className="type-small mt-0.5 text-muted"
          landmark={point.landmark}
          hours={point.hours}
        />
      </span>
      {selected ? (
        <span className="mt-px shrink-0 text-sage-ink" role="img" aria-label={t.delivery.selected}>
          <CheckIcon size={20} />
        </span>
      ) : null}
    </button>
  );
}

/**
 * Region -> city/district -> BTS point, with a search across all points, address, landmark and
 * hours on every point, and «Нет вашего пункта?» falling back to region + free text (flagged as
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
  // which way the last step change went; null until the first one (the opening step does not slide)
  const [moved, setMoved] = useState<'forward' | 'back' | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);
  // Opened on the saved choice: bring its row into view once, so the check is not off-screen.
  const revealPending = useRef(!!initial);
  const reveal = (el: HTMLElement | null) => {
    if (!el || !revealPending.current) return;
    revealPending.current = false;
    scrollWithin(el, 'center');
  };
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

  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    // a new step starts at its top, not where the last list was scrolled to
    if (rootRef.current) scrollWithin(rootRef.current, 'top');
  }, [step]);

  const go = (next: Step, way: 'forward' | 'back' = 'forward') => {
    setStep(next);
    setMoved(way);
    setQuery('');
  };
  const back = () => {
    if (step === 'typed') return go(city ? 'points' : regionId ? 'cities' : 'regions', 'back');
    if (step === 'points') return go('cities', 'back');
    setCity(undefined);
    go('regions', 'back');
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

  /** The saved delivery city (city mode only): marked in its region's list. */
  const savedCity = (c: string) =>
    mode === 'city' && c === initial?.city && regionId === initial.regionId;

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
          <span className={LABEL}>{t.delivery.typedRegion}</span>
          {/* the native picker is the right control on a phone; only its arrow is ours */}
          <span className="relative block">
            <select
              value={typedRegionId ?? ''}
              onChange={(e) => setTypedRegionId(Number(e.target.value) || undefined)}
              className={`${FIELD_BASE} h-12 appearance-none truncate pr-11 pl-3.5`}
            >
              <option value="" disabled />
              {regions.data.map((r) => (
                <option key={r.id} value={r.id}>
                  {name(r)}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 rotate-90 text-muted">
              <ChevronIcon size={18} />
            </span>
          </span>
        </label>
        <div>
          <label htmlFor="typed-address" className={LABEL}>
            {t.delivery.typedLabel}
          </label>
          <textarea
            id="typed-address"
            aria-describedby="typed-address-hint"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder={t.delivery.typedPlaceholder}
            className={`${FIELD_BASE} block resize-none px-3.5 py-3 leading-snug`}
          />
          <p id="typed-address-hint" className="type-hint mt-1.5 text-muted">
            {t.delivery.typedTooShort}
          </p>
        </div>
        <Button type="submit" block disabled={!canSubmitTyped} loading={busy}>
          {t.delivery.typedSubmit}
        </Button>
      </form>
    );
  } else if (searching) {
    const stale = debounced !== q || found.isFetching;
    body = found.isError ? (
      <ErrorState onRetry={() => void found.refetch()} retrying={found.isFetching} />
    ) : !found.data || (stale && found.isPending) ? (
      <Loading points />
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
              context={r ? [name(r), p.city] : [p.city]}
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
            className={`${ROW} ${rowTone(false)}`}
          >
            <span className="type-row min-w-0 flex-1 break-words">{name(r)}</span>
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
            ref={savedCity(c.city) ? reveal : undefined}
            type="button"
            data-testid="city-row"
            aria-current={savedCity(c.city) || undefined}
            onClick={() => pickCity(c.city)}
            className={`${ROW} ${rowTone(savedCity(c.city))}`}
          >
            <span className="min-w-0 flex-1">
              <span className="type-row block break-words">{c.city}</span>
              {mode === 'point' ? (
                <span className="type-small mt-0.5 block text-muted">
                  {plural(language, c.pointCount, t.delivery.pointsCount)}
                </span>
              ) : null}
            </span>
            {busy && c.city === city ? (
              // the city being saved: the one row that answers the tap while the rest wait
              <span className="shrink-0 text-ink">
                <Spinner size={20} />
              </span>
            ) : savedCity(c.city) ? (
              <span className="shrink-0 text-sage-ink" role="img" aria-label={t.delivery.selected}>
                <CheckIcon size={20} />
              </span>
            ) : mode === 'point' ? (
              // a city leads on to its points; in city mode choosing it ends the flow
              <span className="shrink-0 text-muted">
                <ChevronIcon size={18} />
              </span>
            ) : null}
          </button>
        ))}
      </List>
    );
  } else {
    body = points.isError ? (
      <ErrorState onRetry={() => void points.refetch()} retrying={points.isFetching} />
    ) : points.isPending ? (
      <Loading points />
    ) : (
      <List>
        {points.data.map((p) => (
          <PointRow
            key={p.id}
            ref={p.id === selectedPointId ? reveal : undefined}
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
      ? null
      : step === 'cities'
        ? region
          ? name(region)
          : t.delivery.cities
        : step === 'points'
          ? `${city ?? ''}`
          : null;
  const showSearch = step !== 'typed' && (mode === 'point' || step === 'cities');

  return (
    <div ref={rootRef} className="pb-2">
      {showSearch || heading || step === 'typed' ? (
        <div className="sticky top-0 z-10 -mx-4 bg-ground px-4 pt-1.5 pb-3">
          {step === 'typed' ? (
            // the sheet already says what this is for: only the way back, named
            <button
              type="button"
              onClick={back}
              className="type-row -ml-2 flex min-h-11 items-center gap-1 rounded-pill pr-3 pl-2.5 text-ink transition-[background-color,transform] duration-150 hover:bg-field active:scale-[0.97] active:bg-field"
            >
              <span className="rotate-180">
                <ChevronIcon size={20} />
              </span>
              {t.delivery.back}
            </button>
          ) : heading ? (
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
              <p className="type-heading min-w-0 break-words">{heading}</p>
            </div>
          ) : null}
          {showSearch ? (
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted">
                <SearchIcon size={18} />
              </span>
              <input
                ref={searchRef}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // «Найти» on the keyboard: the results are already live, so just put it away
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder={mode === 'point' ? t.delivery.searchPoints : t.delivery.searchCities}
                aria-label={mode === 'point' ? t.delivery.searchPoints : t.delivery.searchCities}
                className={`${SEARCH} ${query ? 'pr-12' : 'pr-3.5'}`}
              />
              {query ? (
                <button
                  type="button"
                  aria-label={t.delivery.clearSearch}
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  className="absolute top-0 right-0 grid size-12 place-items-center rounded-btn text-muted transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-ink active:scale-95"
                >
                  <CloseIcon size={18} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="type-small mb-3 flex items-start gap-2 rounded-btn bg-field px-3 py-2.5 text-ink"
        >
          <span className="shrink-0">
            <AlertIcon size={18} />
          </span>
          <span className="pt-px">{error}</span>
        </p>
      ) : null}
      <div
        // remounts per step, so the new step slides in once (not on every search keystroke)
        key={step}
        aria-busy={busy || undefined}
        className={`transition-opacity duration-150 ${busy ? 'pointer-events-none opacity-60' : ''} ${
          moved === 'forward'
            ? 'animate-[step-forward_0.22s_cubic-bezier(0.23,1,0.32,1)]'
            : moved === 'back'
              ? 'animate-[step-back_0.22s_cubic-bezier(0.23,1,0.32,1)]'
              : ''
        }`}
      >
        {body}
      </div>
      {notFoundLink ? (
        // a quiet way out, as in mockup 06: underlined text, a 44 px tap target
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => go('typed')}
            className="type-small min-h-11 rounded-btn px-2 font-medium text-ink underline decoration-line-strong underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-current"
          >
            {t.delivery.notFound}
          </button>
        </div>
      ) : null}
    </div>
  );
}
