import type { VolumeCard } from '@lummi/contracts';
import { useRef, type KeyboardEvent } from 'react';
import { usePrefs } from '../lib/prefs';
import { Money } from './Money';
import { EASE_OUT } from './photoDisc';

/**
 * One volume, top-aligned so «10 мл / 30 мл / 50 мл» share one baseline whatever sits under them:
 * the volume, then (when any tile shows a markdown) the struck regular price or an empty slot of
 * the same height, then the price to pay, Sage Ink on an unselected tile during a markdown.
 * Selected is the Graphite fill. Sold out is transparent with a faint outline and says so; a
 * sold-out volume can still be chosen (to see its photo), and then gets the selected fill at
 * reduced emphasis (Muted Ink), so it reads as chosen but never as buyable.
 */
function VolumeTile({
  volume: v,
  selected,
  strikeSlot,
  onSelect,
  onKeyDown,
  tileRef,
}: {
  volume: VolumeCard;
  selected: boolean;
  /** Some tile shows a struck regular price: every tile keeps a line for it. */
  strikeSlot: boolean;
  onSelect: (ml: VolumeCard['ml']) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  tileRef: (el: HTMLButtonElement | null) => void;
}) {
  const { t } = usePrefs();
  const soldOut = v.available === 0;
  const struck = !soldOut && v.salePrice !== null;
  const look = soldOut
    ? selected
      ? 'bg-muted text-btn-ink'
      : 'bg-transparent text-faint shadow-[inset_0_0_0_1px_var(--c-line)]'
    : selected
      ? 'bg-btn text-btn-ink'
      : 'bg-card text-ink inset-line';
  const quiet = selected ? 'opacity-80' : 'text-muted';
  return (
    <button
      ref={tileRef}
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      data-sold-out={soldOut || undefined}
      onClick={() => onSelect(v.ml)}
      onKeyDown={onKeyDown}
      className={`flex min-h-16 min-w-0 flex-col items-center justify-start rounded-btn px-1 pt-3 pb-2.5 transition-[background-color,color,box-shadow,transform] duration-150 ${EASE_OUT} active:scale-[0.97] ${look}`}
    >
      <span className="type-price leading-5">
        {v.ml} {t.card.ml}
      </span>
      {struck ? (
        <s className={`mt-0.5 ${selected ? 'opacity-60' : 'text-muted'}`}>
          <Money amount={v.price} size="small" />
        </s>
      ) : strikeSlot ? (
        <span aria-hidden="true" className="type-price-sm invisible mt-0.5">
          0
        </span>
      ) : null}
      {soldOut ? (
        <span className={`type-caption mt-1 ${quiet}`}>{t.card.soldOut}</span>
      ) : (
        <Money
          amount={v.effectivePrice}
          size="small"
          className={`${strikeSlot ? '' : 'mt-0.5'} ${
            struck && !selected ? 'text-sage-ink' : quiet
          }`}
        />
      )}
    </button>
  );
}

/** The 10 / 30 / 50 ml radio group: one tab stop, arrows move the choice (as `Segmented`). */
export function VolumeTiles({
  volumes,
  selected,
  onSelect,
}: {
  volumes: VolumeCard[];
  selected: VolumeCard['ml'];
  onSelect: (ml: VolumeCard['ml']) => void;
}) {
  const { t } = usePrefs();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const strikeSlot = volumes.some((v) => v.available > 0 && v.salePrice !== null);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + volumes.length) % volumes.length;
    const v = volumes[next];
    if (v) {
      onSelect(v.ml);
      refs.current[next]?.focus();
    }
  };
  return (
    <div role="radiogroup" aria-label={t.card.volume} className="grid grid-cols-3 gap-2">
      {volumes.map((v, i) => (
        <VolumeTile
          key={v.ml}
          volume={v}
          selected={v.ml === selected}
          strikeSlot={strikeSlot}
          onSelect={onSelect}
          onKeyDown={(e) => onKey(e, i)}
          tileRef={(el) => {
            refs.current[i] = el;
          }}
        />
      ))}
    </div>
  );
}
