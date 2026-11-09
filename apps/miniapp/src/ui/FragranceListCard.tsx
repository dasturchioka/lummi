import type { FragranceListItem } from '@lummi/contracts';
import { fill, formatMoney } from '@lummi/i18n';
import { useState } from 'react';
import { photoSrcSet, photoUrl } from '../lib/media';
import { usePrefs } from '../lib/prefs';
import { FragranceBadge } from './Badge';

/**
 * One fragrance in a list: the DESIGN.md product card with the card's label lockup (caps attribution
 * «ПО МОТИВАМ <BRAND>», the Cormorant italic name, the meta line, three key notes joined by « · »,
 * «от … сум»). Prices come from the server (`fromPrice`); nothing is computed here.
 *
 * - `layout="grid"`: the 3:4 photo on top, for the catalog grid (two columns, ~170 px wide).
 * - `layout="row"`: the photo left, the lockup right, for result lists.
 * - `compact`: the suggestion row (a thumbnail and the lockup without the Sage rule, the meta and
 *   the notes), separated by hairlines by whoever lists it.
 *
 * It is a button: `onSelect(slug)` opens the fragrance card. The caller owns navigation.
 */
export interface FragranceListCardProps {
  item: FragranceListItem;
  layout?: 'grid' | 'row';
  compact?: boolean;
  onSelect?: (slug: string) => void;
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
    <div
      aria-hidden="true"
      className={`relative shrink-0 overflow-hidden rounded-card bg-photo ${className}`}
    >
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
  const notes = item.keyNotes[language].slice(0, 3);
  const lockup = (
    <span className="flex min-w-0 flex-1 flex-col text-left">
      <span className="type-label text-muted [overflow-wrap:anywhere]">
        {fill(t.card.basedOn, { brand: item.brand })}
      </span>
      <span className="type-name mt-0.5 text-ink [overflow-wrap:anywhere]">{item.name}</span>
      {compact ? null : (
        <>
          <span aria-hidden="true" className="my-2 block h-px w-[18px] bg-sage" />
          <span className="type-small flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
            <FragranceBadge isHit={item.isHit} isNew={item.isNew} />
            <span>
              <span className="tracking-[0.04em] uppercase">{t.card.type[item.type]}</span>
              {item.family ? ` · ${item.family[language]}` : null}
            </span>
          </span>
          {notes.length > 0 ? (
            <span className="type-small mt-1 text-muted [overflow-wrap:anywhere]">
              {notes.join(' · ')}
            </span>
          ) : null}
        </>
      )}
      {item.soldOut ? (
        <span className="type-small mt-2 text-muted">{t.list.soldOut}</span>
      ) : item.fromPrice !== null ? (
        <span className="type-price mt-2 text-ink">
          {fill(t.list.from, { price: formatMoney(item.fromPrice, language) })}
        </span>
      ) : null}
    </span>
  );

  const aria = fill(t.list.open, { name: item.name });
  if (layout === 'grid')
    return (
      <button
        type="button"
        aria-label={aria}
        onClick={() => onSelect?.(item.slug)}
        className="flex w-full flex-col gap-3 rounded-card bg-card p-2 pb-3 text-left text-ink transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]"
      >
        <Thumb
          hash={item.photo}
          sizes="(min-width: 520px) 240px, 45vw"
          className="aspect-[3/4] w-full"
        />
        <span className="flex px-1">{lockup}</span>
      </button>
    );
  return (
    <button
      type="button"
      aria-label={aria}
      onClick={() => onSelect?.(item.slug)}
      className={`flex w-full items-center gap-3 text-left text-ink transition-colors duration-150 active:bg-field ${
        compact ? 'px-1 py-2.5' : 'rounded-card bg-card p-2 pr-3'
      }`}
    >
      <Thumb
        hash={item.photo}
        sizes={compact ? '48px' : '96px'}
        className={compact ? 'w-12 aspect-[3/4] !rounded-[8px]' : 'w-24 aspect-[3/4]'}
      />
      {lockup}
    </button>
  );
}
