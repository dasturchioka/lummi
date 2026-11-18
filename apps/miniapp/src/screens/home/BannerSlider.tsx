import { fill } from '@lummi/i18n';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useHomeContent } from '../../content/home';
import { usePrefs } from '../../lib/prefs';
import { Skeleton } from '../../ui/Skeleton';
import { DiscoveryBanner } from './DiscoveryBanner';

/** The promo slides start off screen: their own chunk, so the first screen carries less code. */
const PromoBanner = lazy(() => import('./PromoBanner'));

/**
 * The track scrolls under the screen gutters, so a slide leaves at the screen's edge and the next
 * one peeks in by the 8 px gap; it snaps slide by slide back onto the gutter, and a hard flick
 * still stops at the next slide (`snap-always`). The 4 px above and below keep the focus ring
 * inside the scroll box. Native scrolling: momentum, and a vertical drag that scrolls the page.
 */
const TRACK =
  'relative -mx-[var(--gutter)] -my-1 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-px-[var(--gutter)] px-[var(--gutter)] py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
/** Every slide is the column's width, and the row stretches them to the tallest one's height. */
const SLIDE = 'flex w-full shrink-0 snap-start snap-always *:flex-1';

/** The slide whose start is nearest the track's snap line. */
function slideAt(track: HTMLElement): number {
  const [first, second] = [track.children[0], track.children[1]];
  if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return 0;
  const stride = second.offsetLeft - first.offsetLeft;
  if (stride <= 0) return 0;
  return Math.min(track.children.length - 1, Math.max(0, Math.round(track.scrollLeft / stride)));
}

/**
 * The Home banner slider (TZ §3.1, ticket #62): the Discovery set slide first, always, then every
 * promo banner the owner has switched on, in the owner's order, all in the one Graphite form and
 * one height. With one slide it is just the Discovery banner: no indicator. It never moves on its
 * own (DESIGN.md «Banner slider»). A carousel to screen readers (WAI-ARIA APG): a labelled region,
 * each slide a group named «2 из 4»; the position marks under it are buttons that bring a slide in.
 */
export function BannerSlider() {
  const { t } = usePrefs();
  const banners = useHomeContent().data?.banners ?? [];
  const total = banners.length + 1;
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el || total < 2) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCurrent(slideAt(el)));
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    return () => {
      el.removeEventListener('scroll', sync);
      cancelAnimationFrame(frame);
    };
  }, [total]);

  const show = (i: number) => {
    const el = track.current;
    const first = el?.children[0];
    const slide = el?.children[i];
    if (!el || !(first instanceof HTMLElement) || !(slide instanceof HTMLElement)) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({
      left: slide.offsetLeft - first.offsetLeft,
      behavior: reduce ? 'auto' : 'smooth',
    });
  };

  const slide = (n: number) => ({
    role: 'group',
    'aria-roledescription': t.home.slide,
    'aria-label': fill(t.home.slideOf, { n: String(n), total: String(total) }),
    className: SLIDE,
  });
  const shown = Math.min(current, total - 1);

  return (
    <section aria-roledescription={t.home.carousel} aria-label={t.home.offers} data-slot="banners">
      {/* polite: it never moves on its own, so a slide brought in by a mark is announced (APG) */}
      <div ref={track} className={TRACK} aria-live="polite" data-testid="banner-track">
        <div {...slide(1)}>
          <DiscoveryBanner />
        </div>
        {banners.map((b, i) => (
          <div key={b.id} {...slide(i + 2)}>
            <Suspense fallback={<Skeleton className="min-h-[140px]" rounded="card" />}>
              <PromoBanner banner={b} />
            </Suspense>
          </div>
        ))}
      </div>
      {total > 1 ? (
        // 2 px marks, the brand's hairline weight; each sits in a 24 px tap target
        <div className="mt-1 -mb-2 flex justify-center" data-testid="banner-dots">
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={fill(t.home.showSlide, { n: String(i + 1), total: String(total) })}
              aria-current={i === shown ? 'true' : undefined}
              onClick={() => show(i)}
              className="grid size-6 place-items-center"
            >
              <span
                aria-hidden="true"
                className={`h-0.5 w-4 rounded-pill transition-colors duration-200 ease-out ${i === shown ? 'bg-ink' : 'bg-faint'}`}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
