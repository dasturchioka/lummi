import type { PromoBanner as Banner } from '@lummi/contracts';
import { keepNumbersTogether } from '@lummi/rich-text';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { routeForStartParam } from '../../lib/startapp';
import { photoSrcSet, photoUrl } from '../../lib/media';
import { usePrefs } from '../../lib/prefs';
import { ArrowRightIcon } from '../../ui/icons';

/**
 * The owner's promo banner, in its own slot under the Discovery set banner, drawn in the same
 * Graphite form (approved variant 2): the photo on the left third, the text on the dark block
 * beside it. The whole banner is one link that opens its `startapp` target through the same route
 * table as a deep link.
 */
export default function PromoBanner({ banner }: { banner: Banner }) {
  const { language } = usePrefs();
  const router = useRouter();
  // a photo that fails leaves its Photo Blush slot, never a broken image
  const [failed, setFailed] = useState(false);
  const uz = language === 'uz';
  const to = routeForStartParam(banner.target);
  // the owner types the text: a number stays with its thousands and its word («69 000 soʻmdan»)
  const title = keepNumbersTogether(uz ? banner.titleUz : banner.titleRu);
  const subtitle = keepNumbersTogether(uz ? banner.subtitleUz : banner.subtitleRu);
  const priceLine = keepNumbersTogether((uz ? banner.priceLineUz : banner.priceLineRu) ?? '');
  return (
    <a
      data-slot="promo"
      href={to}
      onClick={(e) => {
        e.preventDefault();
        void router.navigate({ to });
      }}
      className="flex min-h-[140px] w-full overflow-hidden rounded-card bg-totals text-left text-totals-ink transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99]"
    >
      <div aria-hidden="true" className="relative w-[34%] shrink-0 bg-photo">
        {banner.imageHash && !failed ? (
          <img
            src={photoUrl(banner.imageHash, 400)}
            srcSet={photoSrcSet(banner.imageHash)}
            sizes="140px"
            alt=""
            decoding="async"
            onError={() => setFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 py-4 pr-4 pl-4">
        <div>
          {/* at most 3 + 3 lines, so a banner at its field limits stays a banner (the admin preview clamps alike) */}
          <h2 className="type-heading line-clamp-3 text-balance [overflow-wrap:anywhere]">
            {title}
          </h2>
          <p className="type-body mt-2 line-clamp-3 text-pretty opacity-80 [overflow-wrap:anywhere]">
            {subtitle}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          {priceLine ? (
            <span className="type-price leading-snug whitespace-normal text-pretty [overflow-wrap:anywhere]">
              {priceLine}
            </span>
          ) : (
            <span />
          )}
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-pill bg-bar-ink/20"
          >
            <ArrowRightIcon size={18} />
          </span>
        </div>
      </div>
    </a>
  );
}
