import { DISCOVERY_FAVOURITE } from '@lummi/contracts/constants';
import { fill } from '@lummi/i18n';
import { useFavouriteIds, useToggleFavourite } from '../favourites/queries';
import { usePrefs } from '../lib/prefs';
import { hapticSuccess } from '../lib/telegram';
import { HeartIcon } from './icons';
import { DISC } from './photoDisc';

/**
 * The favourite heart (#45): a 32 px Milk disc at 92% on the photo's top-left corner, with a 44 px
 * tap area, a sibling of the card's own button, never inside it. `disc` is the 40 px overlay on
 * the fragrance card's and the set's big photo. Filled when kept; it toggles at once, and the
 * server's answer (or a rollback) follows. `target` is a fragrance slug or `DISCOVERY_FAVOURITE`.
 */
export function HeartButton({
  target,
  name,
  place = 'photo',
  className = '',
}: {
  target: string;
  name: string;
  /**
   * `photo`: 28 px disc inset 4 px in the photo's top-left, clear of the printed LUMMI. wordmark
   * (it starts a quarter of the way in) on a grid card. `corner`: the top-right of a card whose
   * photo is too narrow for that (a row, the set card). `disc`: the 40 px overlay for the big
   * photos; the caller places it.
   */
  place?: 'photo' | 'corner' | 'disc';
  className?: string;
}) {
  const { t } = usePrefs();
  const ids = useFavouriteIds().data;
  const toggle = useToggleFavourite();
  const on = ids
    ? target === DISCOVERY_FAVOURITE
      ? ids.discoverySet
      : ids.slugs.includes(target)
    : false;
  const small =
    'absolute z-10 grid size-7 place-items-center rounded-pill bg-photo-disc text-photo-disc-ink transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] after:absolute after:-inset-2 active:scale-95';
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={fill(on ? t.list.unfavourite : t.list.favourite, { name })}
      data-testid="heart"
      onClick={() => {
        if (!on) hapticSuccess();
        toggle.mutate({ target, on: !on });
      }}
      className={
        place === 'disc'
          ? `${DISC} ${className}`
          : `${small} ${place === 'photo' ? 'top-1 left-1' : 'top-1 right-1'} ${className}`
      }
    >
      <HeartIcon size={place === 'disc' ? 20 : 16} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}
