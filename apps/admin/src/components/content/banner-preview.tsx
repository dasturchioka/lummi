import { ArrowRight } from 'lucide-react';
import { photoUrl } from '@/components/catalog/photo';

export interface PreviewBanner {
  imageHash: string | null;
  title: string;
  subtitle: string;
  priceLine: string | null;
}

/**
 * The Mini App's promo banner (Home, approved variant 2) at its phone width: the photo on the
 * left third, the text on the Graphite block, price line and arrow at the bottom. A drawing of
 * the same layout with the panel's own tokens, so the owner sees what customers will see.
 */
export function BannerPreview({ banner, label }: { banner: PreviewBanner; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex min-h-[140px] w-full max-w-[358px] overflow-hidden rounded-card bg-graphite text-milk"
    >
      <div className="relative w-[34%] shrink-0 bg-stone">
        {banner.imageHash ? (
          <img
            src={photoUrl(banner.imageHash, 400)}
            alt=""
            className="absolute inset-0 size-full object-cover"
            decoding="async"
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 py-4 pr-4 pl-4">
        <div>
          <p className="text-[17px] leading-snug font-semibold text-balance [overflow-wrap:anywhere]">
            {banner.title}
          </p>
          <p className="mt-2 text-[14px] leading-normal text-pretty opacity-80 [overflow-wrap:anywhere]">
            {banner.subtitle}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">
            {banner.priceLine}
          </span>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-milk/20">
            <ArrowRight className="size-[18px]" strokeWidth={1.5} aria-hidden />
          </span>
        </div>
      </div>
    </div>
  );
}
