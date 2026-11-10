import type { PromoBanner as Banner } from '@lummi/contracts';
import { useRouter } from '@tanstack/react-router';
import { routeForStartParam } from '../../lib/startapp';
import { photoSrcSet, photoUrl } from '../../lib/media';
import { usePrefs } from '../../lib/prefs';
import { ArrowRightIcon } from '../../ui/icons';

/**
 * The owner's promo banner, in the Discovery banner's layout (approved variant 2): the photo on
 * the left third, the text on the dark block beside it. The whole banner is one button that opens
 * its `startapp` target through the same route table as a deep link.
 */
export default function PromoBanner({ banner }: { banner: Banner }) {
  const { language } = usePrefs();
  const router = useRouter();
  const uz = language === 'uz';
  const to = routeForStartParam(banner.target);
  const title = uz ? banner.titleUz : banner.titleRu;
  const subtitle = uz ? banner.subtitleUz : banner.subtitleRu;
  const priceLine = uz ? banner.priceLineUz : banner.priceLineRu;
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
        {banner.imageHash ? (
          <img
            src={photoUrl(banner.imageHash, 400)}
            srcSet={photoSrcSet(banner.imageHash)}
            sizes="140px"
            alt=""
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 py-4 pr-4 pl-4">
        <div>
          <h2 className="type-heading text-balance [overflow-wrap:anywhere]">{title}</h2>
          <p className="type-body mt-2 text-pretty opacity-80 [overflow-wrap:anywhere]">
            {subtitle}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          {priceLine ? (
            <span className="type-row font-semibold [overflow-wrap:anywhere]">{priceLine}</span>
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
