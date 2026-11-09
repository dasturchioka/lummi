import { usePrefs } from '../../lib/prefs';

/** The customer's Discovery box photo (materials/photos), cropped to the box, 420 px wide WebP. */
const BOX_PHOTO = '/home/discovery-set.webp';

/**
 * The dark Discovery set banner (approved variant 2): the box photo on the left, the set on the
 * dark block beside it, named as the brand names a product: «НАБОР» in small caps over
 * «Discovery set» in the Cormorant italic. The sets ticket gives it its price, its arrow and its link; until then the
 * «Скоро» pill sits where they will, and the banner is not a control.
 */
export function DiscoveryBanner() {
  const { t } = usePrefs();
  return (
    <section
      data-slot="discovery"
      className="flex min-h-[140px] overflow-hidden rounded-card bg-totals text-totals-ink"
    >
      <div aria-hidden="true" className="relative w-[34%] shrink-0 bg-photo">
        <img
          src={BOX_PHOTO}
          alt=""
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 py-4 pr-4 pl-4">
        {/* The brand's name block (bb-08): a small caps line, then the set's name in the italic. */}
        <div>
          <p className="type-label opacity-70">{t.home.discoveryLabel}</p>
          <h2 className="type-name-lg mt-1 [overflow-wrap:anywhere]">{t.home.discoveryTitle}</h2>
          <p className="type-body mt-2 text-pretty opacity-80">{t.home.discoveryText}</p>
        </div>
        <span className="type-badge self-start rounded-pill bg-bar-ink/20 px-2.5 py-1.5">
          {t.home.discoverySoon}
        </span>
      </div>
    </section>
  );
}
