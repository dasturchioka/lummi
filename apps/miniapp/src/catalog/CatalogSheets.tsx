import type { Bilingual } from '@lummi/contracts';
import { VOLUMES_ML, SEASONS, CATALOG_SORTS, type CatalogSort } from '@lummi/contracts/constants';
import { fill, formatMoney } from '@lummi/i18n';
import { useState, type ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { CheckIcon } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import type { CatalogSearch } from './filters';

/** One choice per row, the chosen one marked; a tap picks it and closes the sheet. */
function OptionRows<V extends string | number>({
  options,
  value,
  onPick,
}: {
  options: { value: V | undefined; label: string }[];
  value: V | undefined;
  onPick: (v: V | undefined) => void;
}) {
  return (
    <div role="radiogroup" className="flex flex-col divide-y divide-line">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value ?? 'any')}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid="option-row"
            onClick={() => onPick(o.value)}
            className="type-row flex min-h-12 items-center justify-between gap-3 py-2 text-left transition-colors duration-150 active:bg-field"
          >
            <span className={`min-w-0 [overflow-wrap:anywhere] ${selected ? 'font-semibold' : ''}`}>
              {o.label}
            </span>
            {selected ? <CheckIcon size={18} className="shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export type SheetName = 'family' | 'volume' | 'price' | 'season' | 'sort';

interface Props {
  open: SheetName | null;
  onClose: () => void;
  filters: CatalogSearch;
  onChange: (patch: Partial<CatalogSearch>) => void;
  families: { id: number; name: Bilingual }[];
  priceBounds: { min: number; max: number } | null;
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 9);
const group = (v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function PriceFields({
  filters,
  bounds,
  onApply,
}: {
  filters: CatalogSearch;
  bounds: { min: number; max: number } | null;
  onApply: (min: number | undefined, max: number | undefined) => void;
}) {
  const { t, language } = usePrefs();
  const [min, setMin] = useState(filters.min === undefined ? '' : String(filters.min));
  const [max, setMax] = useState(filters.max === undefined ? '' : String(filters.max));
  const field = (id: string, label: string, v: string, set: (s: string) => void) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="type-hint text-muted">{label}</span>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="done"
        value={group(v)}
        placeholder={t.catalog.pricePlaceholder}
        onChange={(e) => set(digits(e.target.value))}
        className="h-12 w-full rounded-btn bg-field px-3.5 text-base text-ink placeholder:text-muted"
      />
    </label>
  );
  const apply = () => {
    let lo = min === '' ? undefined : Number(min);
    let hi = max === '' ? undefined : Number(max);
    if (lo !== undefined && hi !== undefined && lo > hi) [lo, hi] = [hi, lo];
    onApply(lo, hi);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="flex flex-col gap-4 pt-1"
    >
      {bounds ? (
        <p className="type-small text-muted">
          {fill(t.catalog.priceRange, {
            from: formatMoney(bounds.min, language),
            to: formatMoney(bounds.max, language),
          })}
        </p>
      ) : null}
      <div className="flex gap-2">
        {field('price-min', t.catalog.priceFrom, min, setMin)}
        {field('price-max', t.catalog.priceTo, max, setMax)}
      </div>
      <div className="flex flex-col gap-2">
        <Button type="submit" block>
          {t.catalog.apply}
        </Button>
        {filters.min !== undefined || filters.max !== undefined ? (
          <Button
            type="button"
            variant="secondary"
            block
            onClick={() => onApply(undefined, undefined)}
          >
            {t.catalog.reset}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** The filter and sort sheets of the catalog; one is open at a time. Loaded when the first opens. */
export default function CatalogSheets({
  open,
  onClose,
  filters,
  onChange,
  families,
  priceBounds,
}: Props) {
  const { t, language } = usePrefs();
  const pick = (patch: Partial<CatalogSearch>) => {
    onChange(patch);
    onClose();
  };
  const titles: Record<SheetName, string> = {
    family: t.catalog.filters.family,
    volume: t.catalog.filters.volume,
    price: t.catalog.filters.price,
    season: t.catalog.filters.season,
    sort: t.catalog.sort.label,
  };
  let body: ReactNode = null;
  if (open === 'family') {
    const sorted = [...families].sort((a, b) =>
      a.name[language].localeCompare(b.name[language], language),
    );
    body = (
      <OptionRows
        value={filters.family}
        options={[
          { value: undefined, label: t.catalog.anyFamily },
          ...sorted.map((f) => ({ value: f.id, label: f.name[language] })),
        ]}
        onPick={(v) => pick({ family: v })}
      />
    );
  } else if (open === 'volume') {
    body = (
      <OptionRows
        value={filters.volume}
        options={[
          { value: undefined, label: t.catalog.anyVolume },
          ...VOLUMES_ML.map((ml) => ({ value: ml, label: `${ml} ${t.card.ml}` })),
        ]}
        onPick={(v) => pick({ volume: v })}
      />
    );
  } else if (open === 'season') {
    body = (
      <OptionRows
        value={filters.season}
        options={[
          { value: undefined, label: t.catalog.anySeason },
          ...SEASONS.map((s) => ({ value: s, label: t.card.season[s] })),
        ]}
        onPick={(v) => pick({ season: v })}
      />
    );
  } else if (open === 'sort') {
    body = (
      <OptionRows<CatalogSort>
        value={filters.sort ?? 'top'}
        options={CATALOG_SORTS.map((s) => ({ value: s, label: t.catalog.sort[s] }))}
        onPick={(v) => pick({ sort: v === 'top' ? undefined : v })}
      />
    );
  } else if (open === 'price') {
    body = (
      <PriceFields
        filters={filters}
        bounds={priceBounds}
        onApply={(min, max) => pick({ min, max })}
      />
    );
  }
  return (
    <Sheet
      open={open !== null}
      onOpenChange={(o) => !o && onClose()}
      title={open ? titles[open] : ''}
      closeLabel={t.common.close}
      tall={open === 'family'}
    >
      {body}
    </Sheet>
  );
}
