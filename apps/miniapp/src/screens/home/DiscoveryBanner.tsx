import { Link } from '@tanstack/react-router';
import { usePrefs } from '../../lib/prefs';
import { useDiscoverySet } from '../../sets/queries';
import { ArrowRightIcon } from '../../ui/icons-core';
import { Money } from '../../ui/Money';
import { SetPhoto } from '../../ui/SetPhoto';

/**
 * The dark Discovery set banner (approved variant 2): the box photo on the left, the set on the
 * dark block beside it, named as the brand names a product: «НАБОР» in small caps over
 * «Discovery set» in the Cormorant italic. The whole banner opens the set; the price is the
 * server's (the owner's photo replaces the shipped box photo once uploaded).
 */
export function DiscoveryBanner() {
  const { t } = usePrefs();
  const set = useDiscoverySet().data;
  return (
    <Link
      to="/sets/discovery"
      data-slot="discovery"
      aria-label={`${t.home.discoveryLabel}: ${t.home.discoveryTitle}`}
      className="flex min-h-[140px] overflow-hidden rounded-card bg-totals text-totals-ink transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]"
    >
      <div aria-hidden="true" className="relative w-[34%] shrink-0 bg-photo">
        <SetPhoto hash={set?.photo ?? null} sizes="140px" eager />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 py-4 pr-4 pl-4">
        {/* The brand's name block (bb-08): a small caps line, then the set's name in the italic. */}
        <div>
          <p className="type-label opacity-70">{t.home.discoveryLabel}</p>
          <h2 className="type-name-lg mt-1 [overflow-wrap:anywhere]">{t.home.discoveryTitle}</h2>
          <p className="type-body mt-2 text-pretty opacity-80">{t.home.discoveryText}</p>
        </div>
        <span className="flex items-center justify-between gap-3">
          {set ? <Money amount={set.price} /> : <span aria-hidden="true" className="h-[22px]" />}
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-pill bg-bar-ink/20"
          >
            <ArrowRightIcon size={16} />
          </span>
        </span>
      </div>
    </Link>
  );
}
