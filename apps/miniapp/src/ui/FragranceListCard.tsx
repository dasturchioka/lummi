import type { FragranceListItem } from '@lummi/contracts';
import { fill, formatMoney } from '@lummi/i18n';
import { useState } from 'react';
import { photoSrcSet, photoUrl } from '../lib/media';
import { usePrefs } from '../lib/prefs';
import { AddButton } from './AddButton';
import { attribution } from './attribution';
import { FragranceBadge } from './Badge';
import { HeartButton } from './HeartButton';

/**
 * One fragrance in a list: the DESIGN.md product card with the card's label lockup (caps attribution
 * «ПО МОТИВАМ <BRAND>», the Cormorant italic name, the meta line, three key notes joined by « · »,
 * «от … сум»). Prices come from the server (`fromPrice`); nothing is computed here.
 *
 * - `layout="grid"`: the 3:4 photo on top, for the catalog grid (two columns, ~170 px wide). The
 *   meta line keeps the badge and the type (no room for the family), the notes stop at two lines,
 *   and the price sits on the card's bottom edge so a row of cards lines up.
 * - `layout="row"`: the photo left, the lockup right, for result lists.
 * - `compact`: the suggestion row (a thumbnail and the lockup without the Sage rule, the meta and
 *   the notes), separated by hairlines by whoever lists it.
 *
 * The whole card is one button (`onSelect(slug)` opens the fragrance card; the caller owns
 * navigation), laid over the content rather than wrapping it. The heart (top-left of the photo,
 * #45) and the «+» (`AddButton`, bottom-right of the photo, #25) sit above it, never inside it.
 * The «+» stays off the price line, so a seven-digit price («1 250 000 soʻmdan») keeps its full
 * size and its own line on a 360 px phone (#15, #16 reviews). A compact row has no «+».
 */
export interface FragranceListCardProps {
  item: FragranceListItem;
  layout?: 'grid' | 'row';
  compact?: boolean;
  onSelect?: (slug: string) => void;
}

const NBSP = ' ';

/** Text that wraps only between its words: «Цветочно-фруктовый» never breaks after its hyphen. */
function Unhyphenated({ text }: { text: string }) {
  return text.split(' ').map((word, i) => (
    <span key={i}>
      {i > 0 ? ' ' : null}
      <span className="whitespace-nowrap">{word}</span>
    </span>
  ));
}

function Thumb({
  hash,
  sizes,
  className,
}: {
  hash: string | null;
  sizes: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div aria-hidden="true" className={`relative shrink-0 overflow-hidden bg-photo ${className}`}>
      {hash && !failed ? (
        <img
          src={photoUrl(hash, 400)}
          srcSet={photoSrcSet(hash)}
          sizes={sizes}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}

export function FragranceListCard({
  item,
  layout = 'row',
  compact = false,
  onSelect,
}: FragranceListCardProps) {
  const { t, language } = usePrefs();
  const grid = layout === 'grid' && !compact;
  const notes = item.keyNotes[language].slice(0, 3);
  // Nothing to buy: the bottle steps back, so a grid scans for what is in stock before the eye
  // reaches «Нет в наличии» on the price line.
  const faded = item.soldOut ? 'opacity-55' : '';

  // The price line, or «Нет в наличии» in its place; 30 px tall on cards. It has the card's whole
  // width (the «+» is on the photo), so it never steps down.
  const price = item.soldOut ? (
    <span className="type-small text-muted">{t.list.soldOut}</span>
  ) : item.fromPrice !== null ? (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="type-price text-ink">
        {fill(t.list.from, { price: formatMoney(item.fromPrice, language) })}
      </span>
      {item.fromRegularPrice !== null ? (
        <s data-testid="regular-price" className="type-price-sm text-muted">
          {formatMoney(item.fromRegularPrice, language)}
        </s>
      ) : null}
    </span>
  ) : null;

  const lockup = (
    <>
      {/* Balanced: «ПО МОТИВАМ / LOUIS VUITTON», never «ПО МОТИВАМ LOUIS / VUITTON» on a wide row. */}
      <span className="type-label-sm text-balance text-muted [overflow-wrap:anywhere]">
        {attribution(t.card.basedOn, item.brand)}
      </span>
      <span
        className={`text-pretty text-ink [overflow-wrap:anywhere] ${
          compact
            ? 'type-name mt-px text-[18px]'
            : grid
              ? 'type-name mt-0.5 text-[22px]'
              : 'type-name-lg mt-0.5'
        }`}
      >
        {item.name}
      </span>
      {compact ? null : (
        <>
          <span aria-hidden="true" className="mt-2 mb-1.5 block h-px w-[18px] bg-sage" />
          {/*
            One inline line, so a wrap starts back at the left edge (not under the type): the badge,
            the type in caps, then the family, which never splits at a hyphen. The grid has no room
            for the family.
          */}
          <span className="type-small text-muted">
            {item.isHit || item.isNew ? (
              <span className="mr-2">
                <FragranceBadge isHit={item.isHit} isNew={item.isNew} />
              </span>
            ) : null}
            <span className="tracking-[0.04em] uppercase">{t.card.type[item.type]}</span>
            {item.family && !grid ? (
              <>
                {`${NBSP}· `}
                <Unhyphenated text={item.family[language]} />
              </>
            ) : null}
          </span>
          {notes.length > 0 ? (
            <span
              className={`type-small mt-1 text-muted [overflow-wrap:anywhere] ${
                grid ? 'line-clamp-2' : ''
              }`}
            >
              {/* A no-break space before each dot: a wrap leaves the dot at the line's end, like a comma. */}
              {notes.join(`${NBSP}· `)}
            </span>
          ) : null}
        </>
      )}
    </>
  );

  const button = (
    <button
      type="button"
      aria-label={fill(t.list.open, { name: item.name })}
      onClick={() => onSelect?.(item.slug)}
      className={`absolute inset-0 ${compact ? '' : 'rounded-card'}`}
    />
  );
  // Press feedback on the whole card while its button is down: cards give a little, rows wash.
  const press = compact
    ? 'transition-colors duration-150 has-[>button:active]:bg-field'
    : 'transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] has-[>button:active]:scale-[0.98]';

  if (grid)
    return (
      <div
        className={`relative flex h-full flex-col rounded-card bg-card p-2 pb-3 text-ink ${press}`}
      >
        <div className="relative">
          <Thumb
            hash={item.photo}
            sizes="(min-width: 520px) 240px, 45vw"
            className={`aspect-[3/4] w-full rounded-photo ${faded}`}
          />
          <HeartButton target={item.slug} name={item.name} />
          <AddButton item={item} />
        </div>
        <span className="flex flex-1 flex-col px-1 pt-2.5">
          {lockup}
          <span className="mt-auto flex min-h-[30px] items-end pt-2.5">{price}</span>
        </span>
        {button}
      </div>
    );
  return (
    <div
      className={`relative flex items-center gap-3 text-ink ${press} ${
        compact ? 'px-1 py-2.5' : 'rounded-card bg-card p-2 pr-3'
      }`}
    >
      {compact ? (
        <Thumb
          hash={item.photo}
          sizes="48px"
          className={`aspect-[3/4] w-12 rounded-thumb ${faded}`}
        />
      ) : (
        <div className="relative shrink-0">
          <Thumb
            hash={item.photo}
            sizes="96px"
            className={`aspect-[3/4] w-24 rounded-photo ${faded}`}
          />
          <AddButton item={item} />
        </div>
      )}
      {/* A row's photo is too narrow to keep the heart clear of the wordmark: it takes the card's corner. */}
      {compact ? null : <HeartButton target={item.slug} name={item.name} place="corner" />}
      <span className={`flex min-w-0 flex-1 flex-col ${compact ? '' : 'pr-5'}`}>
        {lockup}
        {price ? (
          <span className={`flex items-center ${compact ? 'mt-1' : 'mt-1.5 min-h-[30px]'}`}>
            {price}
          </span>
        ) : null}
      </span>
      {button}
    </div>
  );
}
