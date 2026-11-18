import type { StepUp, VolumeCard } from '@lummi/contracts';
import { fill, formatMoney } from '@lummi/i18n';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { saleEndDate } from '../lib/format';
import { usePrefs } from '../lib/prefs';
import { Badge } from './Badge';
import { ChevronIcon } from './icons';
import { Money } from './Money';
import { EASE_OUT } from './photoDisc';

/**
 * One volume, top-aligned so «10 мл / 30 мл / 50 мл» share one baseline whatever sits under them:
 * the volume, then (when any tile shows a markdown or an upgrade right) the struck regular price or
 * an empty slot of the same height, then the price to pay, Sage Ink on an unselected tile then.
 * Selected is the Graphite fill. Sold out is transparent with a faint outline and says so; a
 * sold-out volume can still be chosen (to see its photo), and then gets the selected fill at
 * reduced emphasis (Muted Ink), so it reads as chosen but never as buyable. Where there is no
 * photo to see (the list «+» sheet) it cannot be chosen at all.
 */
function VolumeTile({
  volume: v,
  rightPrice,
  selected,
  strikeSlot,
  locked,
  onSelect,
  onKeyDown,
  tileRef,
}: {
  volume: VolumeCard;
  /** The price with the customer's upgrade right on this volume, from the server (#38). */
  rightPrice: number | undefined;
  selected: boolean;
  /** Some tile shows a struck regular price: every tile keeps a line for it. */
  strikeSlot: boolean;
  /** Sold out and not choosable here. */
  locked: boolean;
  onSelect: (ml: VolumeCard['ml']) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  tileRef: (el: HTMLButtonElement | null) => void;
}) {
  const { t } = usePrefs();
  const soldOut = v.available === 0;
  const struck = !soldOut && (v.salePrice !== null || rightPrice !== undefined);
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
      disabled={locked}
      onClick={() => onSelect(v.ml)}
      onKeyDown={onKeyDown}
      className={`flex min-h-16 min-w-0 flex-col items-center justify-start rounded-btn px-1 pt-3 pb-2.5 transition-[background-color,color,box-shadow,transform] duration-150 ${EASE_OUT} ${locked ? 'cursor-default' : 'active:scale-[0.97]'} ${look}`}
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
          amount={rightPrice ?? v.effectivePrice}
          size="small"
          className={`${strikeSlot ? '' : 'mt-0.5'} ${
            struck && !selected ? 'text-sage-ink' : quiet
          }`}
        />
      )}
    </button>
  );
}

/**
 * The 10 / 30 / 50 ml radio group: one tab stop, arrows move the choice (as `Segmented`).
 * `soldOutChoosable={false}` (the list «+» sheet): sold-out tiles are disabled and the arrows pass
 * over them.
 */
export function VolumeTiles({
  volumes,
  rightPrices = {},
  selected,
  onSelect,
  soldOutChoosable = true,
  focusTick,
}: {
  volumes: VolumeCard[];
  /** Per volume, the price with the customer's upgrade right (the fragrance card, #38): struck like a markdown. */
  rightPrices?: Partial<Record<VolumeCard['ml'], number>>;
  selected: VolumeCard['ml'];
  onSelect: (ml: VolumeCard['ml']) => void;
  soldOutChoosable?: boolean;
  /**
   * Bumped by a choice made outside the tiles (the step-up, #57): the chosen tile takes the focus,
   * so it is announced and the keyboard stays in the group instead of falling to the page's top.
   */
  focusTick?: number;
}) {
  const { t } = usePrefs();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focused = useRef(focusTick);
  useEffect(() => {
    if (focusTick === focused.current) return;
    focused.current = focusTick;
    refs.current[volumes.findIndex((v) => v.ml === selected)]?.focus({ preventScroll: true });
  }, [focusTick, selected, volumes]);
  const strikeSlot = volumes.some(
    (v) => v.available > 0 && (v.salePrice !== null || rightPrices[v.ml] !== undefined),
  );
  const locked = (v: VolumeCard) => !soldOutChoosable && v.available === 0;
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    let next = i;
    do next = (next + dir + volumes.length) % volumes.length;
    while (next !== i && locked(volumes[next]!));
    const v = volumes[next];
    if (v && next !== i) {
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
          rightPrice={rightPrices[v.ml]}
          selected={v.ml === selected}
          strikeSlot={strikeSlot}
          locked={locked(v)}
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

/**
 * Under the tiles, for the chosen volume that can be bought: «В наличии» with a Sage dot and,
 * during a markdown, a row that names the volume it belongs to («10 мл · −20% · до 15 ноября»;
 * ADR 0008: no timer). A sold-out volume shows nothing here: its tile and the dock already say it.
 * `showCount`: the real available count after it («В наличии: 12 шт.»).
 * `stock={false}` (the list «+» sheet, where only what is in stock can be chosen): the markdown
 * row alone.
 */
export function VolumeStatus({
  volume,
  stock = true,
  showCount = false,
}: {
  volume: VolumeCard;
  stock?: boolean;
  /** Setting `catalog.showAvailableCount`: «В наличии: 12 шт.», the server's real available count. */
  showCount?: boolean;
}) {
  const { t, language } = usePrefs();
  if (volume.available === 0 || (!stock && volume.salePrice === null)) return null;
  const until =
    volume.saleEndsAt !== null
      ? fill(t.card.saleUntil, { date: saleEndDate(volume.saleEndsAt, language) })
      : null;
  return (
    <div className="type-small flex flex-col gap-1.5 text-muted">
      {stock ? (
        <span className="flex items-center gap-2" data-availability="in-stock">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-pill bg-sage" />
          {showCount
            ? fill(t.card.inStockCount, { count: String(volume.available) })
            : t.card.inStock}
        </span>
      ) : null}
      {volume.salePrice !== null ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-ink">
            {volume.ml} {t.card.ml}
          </span>
          <span aria-hidden="true">·</span>
          <Badge tone="discount">−{volume.salePercent}%</Badge>
          {until ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">{until}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Under the tiles (#57, #60): the chosen volume's Step-up as one quiet control, «С 30 мл экономия
 * 58 000 сум» / «30 ml olsangiz, 58 000 soʻm tejaysiz», a chevron at the right; a tap chooses that
 * volume. The server decided it is worth offering and computed the saving (`stepUps`); this only
 * draws it. Outlined like a secondary control (hairline-strong inset, radius 10); pressed it
 * washes to Milk Field at once and fades back on release. The saving alone is Sage Ink 600 (savings
 * are Sage Ink, DESIGN.md); no emoji, no box of colour. The parent moves the focus to the chosen
 * tile (`focusTick`).
 */
export function StepUpRow({
  stepUp,
  onChoose,
}: {
  stepUp: StepUp;
  onChoose: (ml: StepUp['toMl']) => void;
}) {
  const { t, language } = usePrefs();
  const amount = formatMoney(stepUp.saving, language);
  const ml = String(stepUp.toMl);
  const [before = '', after = ''] = fill(t.card.stepUpSave, { ml, amount: '\u0000' }).split(
    '\u0000',
  );
  return (
    <button
      type="button"
      data-testid="step-up"
      aria-label={fill(t.card.stepUpChoose, {
        ml,
        offer: fill(t.card.stepUpSave, { ml, amount }),
      })}
      onClick={() => onChoose(stepUp.toMl)}
      className={`type-small inset-line flex min-h-11 w-full items-center justify-between gap-3 rounded-btn px-3.5 py-2 text-left text-muted transition-colors duration-150 ${EASE_OUT} hover:bg-field active:bg-field active:duration-0`}
    >
      <span className="text-pretty">
        {before}
        <span className="font-semibold whitespace-nowrap text-sage-ink">{amount}</span>
        {after}
      </span>
      <ChevronIcon size={16} className="shrink-0 text-ink" />
    </button>
  );
}
