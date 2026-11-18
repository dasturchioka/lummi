import type { AdminBanner } from '@lummi/contracts';
import { fill, formatMoney } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { ArrowRight, Package } from 'lucide-react';
import { photoUrl } from '@/components/catalog/photo';
import type { AdminMessages } from '@/lib/i18n';
import { BannerPreview } from './banner-preview';
import { bannerTitle } from './banner-title';

/** What the Discovery slide shows: the set's price and the owner's photo (null: the shipped box photo). */
export interface DiscoverySlide {
  price: number;
  photo: string | null;
}

/**
 * The Discovery set slide as Home draws it (`apps/miniapp/src/screens/home/DiscoveryBanner.tsx`):
 * the photo on the left third, «НАБОР» in label caps over «Discovery set» in the Name face, the
 * Mini App's own line and the price. Until the owner uploads a photo the app shows the box photo
 * it ships with (the admin does not carry it): here the slot shows a box on Stone.
 */
function DiscoveryPreview({ set, language }: { set: DiscoverySlide; language: 'ru' | 'uz' }) {
  const h = miniappMessages[language].home;
  return (
    <div className="flex min-h-[140px] w-full flex-1 overflow-hidden rounded-card bg-brand-graphite text-brand-milk">
      <div className="relative grid w-[34%] shrink-0 place-items-center bg-brand-stone">
        {set.photo ? (
          <img
            src={photoUrl(set.photo, 400)}
            alt=""
            className="absolute inset-0 size-full object-cover"
            decoding="async"
          />
        ) : (
          <Package className="size-7 text-brand-graphite/60" strokeWidth={1.5} aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 py-4 pr-4 pl-4">
        <div>
          <p className="font-display text-[10.5px] leading-[1.45] tracking-[0.2em] uppercase opacity-70">
            {h.discoveryLabel}
          </p>
          <p className="mt-1 font-name text-[24px] leading-[1.1] font-medium italic">
            {h.discoveryTitle}
          </p>
          <p className="mt-2 text-[14px] leading-normal text-pretty opacity-80">
            {h.discoveryText}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">
            {formatMoney(set.price, language)}
          </span>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-milk/20">
            <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * «Так листается слайдер на Главной»: the Home banner slider in its order, at the phone's 358 px
 * slide width. The Discovery set slide is first, always, then the banners that are on. Each slide
 * carries its number, the same number the list beside it shows. On a phone the strip swipes and
 * snaps like the app; wider, the slides stand side by side and the row scrolls.
 */
export function SliderPreview({
  banners,
  discovery,
  t,
  language,
}: {
  /** The active banners, in slider order. */
  banners: AdminBanner[];
  discovery: DiscoverySlide | null;
  t: AdminMessages;
  language: 'ru' | 'uz';
}) {
  const b = t.content.banner;
  const caption = 'mb-2 flex items-baseline gap-2 text-[12.5px] font-medium text-muted-foreground';
  const number = 'font-semibold text-foreground tabular-nums';
  return (
    // min-w-0: a grid item would otherwise grow to the whole strip and widen the page
    <section aria-label={b.sliderLabel} className="grid min-w-0 gap-2" data-slider-preview>
      <p className="text-[12.5px] font-medium text-muted-foreground">{b.slider}</p>
      <div className="-mx-4 min-w-0 rounded-none bg-field py-4 sm:mx-0 sm:rounded-card">
        <ol className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:thin]">
          <li className="flex w-[min(358px,calc(100vw-48px))] shrink-0 snap-start flex-col">
            <p className={caption}>
              <span className={number}>1</span>
              <span className="truncate">
                Discovery set · {b.discoveryFirst.toLocaleLowerCase(language)}
              </span>
            </p>
            {discovery ? (
              <DiscoveryPreview set={discovery} language={language} />
            ) : (
              <div className="min-h-[140px] flex-1 rounded-card bg-brand-graphite" />
            )}
          </li>
          {banners.map((x, i) => (
            <li
              key={x.id}
              className="flex w-[min(358px,calc(100vw-48px))] shrink-0 snap-start flex-col"
            >
              <p className={caption}>
                <span className={number}>{i + 2}</span>
                <span className="truncate">{bannerTitle(x, language, b.untitled)}</span>
              </p>
              <BannerPreview
                className="flex-1"
                label={fill(b.slide, { n: String(i + 2) })}
                banner={{
                  imageHash: x.imageHash,
                  title: language === 'uz' ? x.titleUz : x.titleRu,
                  subtitle: language === 'uz' ? x.subtitleUz : x.subtitleRu,
                  priceLine: language === 'uz' ? x.priceLineUz : x.priceLineRu,
                }}
              />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
