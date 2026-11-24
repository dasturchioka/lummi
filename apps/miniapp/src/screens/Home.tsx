import type { Theme } from '@lummi/contracts';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { DeliveryRow } from '../delivery/DeliveryRow';
import { usePrefs } from '../lib/prefs';
import { SearchIcon } from '../ui/icons-core';
import { ProfilePhotoImage } from '../ui/ProfilePhotoImage';
import { Logo, Monogram } from '../ui/Logo';
import { Screen } from '../ui/Screen';
import { SearchField } from '../ui/SearchField';
import { GridSkeleton } from '../ui/GridSkeleton';
import { Skeleton } from '../ui/Skeleton';
import { useHomeContent } from '../content/home';
import { BannerSlider } from './home/BannerSlider';

/** Below the fold: its own chunk, so the first screen carries less code. */
const Popular = lazy(() => import('./home/Popular'));
const Novelties = lazy(() => import('./home/Novelties'));

/**
 * The fabric photos of the top block (approved variant 2), one per theme: files in `public/home/`,
 * paths here. Light has the customer's photo (884 px wide; a 1170 px original is asked in
 * open-questions). Dark has none yet and keeps the stand-in: Dark Block with the hairline arcs of
 * the brandbook cover.
 */
const FABRIC: Record<Theme, string | null> = { light: '/home/fabric-light.webp', dark: null };

/** Two hairline arcs, as on the brandbook cover (bb-01). Stand-in only; a photo replaces them. */
function CoverArcs() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 -z-10 size-full text-line-strong"
      viewBox="0 0 390 260"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
    >
      <circle cx="420" cy="300" r="190" vectorEffect="non-scaling-stroke" />
      <circle cx="0" cy="262" r="96" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function TopBlock() {
  const { t, theme, language } = usePrefs();
  const slogan = useHomeContent().data?.slogan;
  const photo = FABRIC[theme];
  return (
    <section
      data-slot="fabric"
      className="sticky top-0 isolate overflow-hidden bg-block text-ink"
      style={{ paddingTop: 'var(--safe-t, 0px)' }}
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          decoding="async"
          fetchPriority="high"
          className="absolute inset-0 -z-10 size-full object-cover"
        />
      ) : (
        <CoverArcs />
      )}
      {/* The slot's own proportion, so a photo never shifts the layout when it arrives. */}
      <div className="flex aspect-[3/2] flex-col items-center px-5 pt-8 text-center">
        <Logo height={24} />
        <p className="type-slogan mt-3 text-balance">{slogan?.[language] ?? t.home.slogan}</p>
      </div>
    </section>
  );
}

/**
 * «Популярное» while its chunk arrives: the title line, the chip row and the grid in their real
 * sizes, so the section that replaces it lands without moving anything.
 */
function PopularSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-3 flex h-5 items-center justify-between">
        <Skeleton className="h-3 w-32" rounded="pill" />
        <Skeleton className="h-3 w-12" rounded="pill" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {['w-[76px]', 'w-[100px]', 'w-[96px]', 'w-[100px]'].map((w, i) => (
          <Skeleton key={i} className={`h-10 shrink-0 ${w}`} rounded="pill" />
        ))}
      </div>
      <div className="mt-3">
        <GridSkeleton />
      </div>
    </div>
  );
}

// shrink-0: a long delivery city truncates in the middle; the discs never squeeze into pills
const DISC =
  'grid size-11 shrink-0 place-items-center rounded-pill bg-card text-ink transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95';

/**
 * The search row and field, pinned under the top safe area while the page scrolls (Sardor
 * 2026-11-24: the header stays on screen). The band above it (the safe area) is painted Milk, so
 * nothing shows through behind Telegram's buttons while it is stuck; a hairline shows then too.
 */
function HomeHeader({ children }: { children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // stuck once the line above the header passes under the top safe area, where it sticks
    // (the header's resolved `top`; the variable itself is an unresolved max())
    const safeTop = header.current ? parseFloat(getComputedStyle(header.current).top) || 0 : 0;
    const io = new IntersectionObserver(
      ([e]) => setUnder(e ? !e.isIntersecting && e.boundingClientRect.top < safeTop + 1 : false),
      { rootMargin: `${-Math.round(safeTop)}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="-mb-px h-px" />
      <div
        ref={header}
        data-slot="home-header"
        className={`sticky z-20 border-b bg-ground pb-3 transition-colors duration-200 ${
          // the Milk band over the safe area only while stuck: at rest it would cover the fabric
          under
            ? 'border-line before:absolute before:inset-x-0 before:bottom-full before:h-[var(--safe-t,0px)] before:bg-ground'
            : 'border-transparent'
        }`}
        style={{
          top: 'var(--safe-t, 0px)',
          marginLeft: 'calc(-1 * max(var(--gutter), var(--safe-l, 0px)))',
          marginRight: 'calc(-1 * max(var(--gutter), var(--safe-r, 0px)))',
          paddingLeft: 'max(var(--gutter), var(--safe-l, 0px))',
          paddingRight: 'max(var(--gutter), var(--safe-r, 0px))',
        }}
      >
        {children}
      </div>
    </>
  );
}

/**
 * Home, no welcome screen (approved design): the top block, then the Milk sheet over its edge.
 * The top block stays still and the sheet slides up over it; the search row and field stick.
 */
export function Home() {
  const { t, customer } = usePrefs();
  return (
    <Screen bleed>
      <TopBlock />
      <div
        className="relative z-10 -mt-3 flex flex-1 flex-col rounded-t-card bg-ground pt-3"
        style={{
          paddingLeft: 'max(var(--gutter), var(--safe-l, 0px))',
          paddingRight: 'max(var(--gutter), var(--safe-r, 0px))',
        }}
      >
        {/*
          The approved row: search left, avatar right, on white discs, the delivery city between
          them. Search opens the search screen.
        */}
        <HomeHeader>
          <div className="flex h-11 items-center justify-between gap-2">
            <Link to="/search" aria-label={t.home.search} className={DISC}>
              <SearchIcon size={20} />
            </Link>
            <DeliveryRow />
            <Link
              to="/profile"
              aria-label={t.tabs.profile}
              className={`${DISC} relative overflow-hidden`}
            >
              <Monogram size={22} />
              <ProfilePhotoImage photo={customer?.photo} sizes="44px" />
            </Link>
          </div>
          <div className="mt-4">
            <SearchField />
          </div>
        </HomeHeader>
        <div className="mt-[calc(var(--section)-12px)] flex flex-col gap-[var(--section)] pb-4">
          <BannerSlider />
          <Suspense fallback={<PopularSkeleton />}>
            <Popular />
          </Suspense>
          <Suspense fallback={null}>
            <Novelties />
          </Suspense>
        </div>
      </div>
    </Screen>
  );
}
