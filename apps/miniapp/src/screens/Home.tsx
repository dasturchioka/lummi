import type { Theme } from '@lummi/contracts';
import { lazy, Suspense } from 'react';
import { Link } from '@tanstack/react-router';
import { DeliveryRow } from '../delivery/DeliveryRow';
import { usePrefs } from '../lib/prefs';
import { SearchIcon } from '../ui/icons';
import { Logo, Monogram } from '../ui/Logo';
import { Screen } from '../ui/Screen';
import { SearchField } from '../ui/SearchField';
import { GridSkeleton } from '../ui/GridSkeleton';
import { Skeleton } from '../ui/Skeleton';
import { useBanner, useSlogan } from '../content/queries';
import { DiscoveryBanner } from './home/DiscoveryBanner';
import { PromoBanner } from './home/PromoBanner';

/** Below the fold: its own chunk, so the first screen carries less code. */
const Popular = lazy(() => import('./home/Popular'));
const Novelties = lazy(() => import('./home/Novelties'));

/**
 * The fabric photos of the top block (approved variant 2), one per theme. To ship them, put the
 * files in `public/home/` and set the two paths here; nothing else changes. Export them as WebP,
 * 3:2, at least 1170 px wide, with a quiet area in the upper third for the logo and slogan.
 * Until then the slot shows the stand-in: Stone (Dark Block in dark) with the hairline arcs of
 * the brandbook cover.
 */
const FABRIC: Record<Theme, string | null> = { light: null, dark: null };

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
  const slogan = useSlogan().data?.slogan;
  const photo = FABRIC[theme];
  return (
    <section
      data-slot="fabric"
      className="relative isolate overflow-hidden bg-block text-ink"
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

/**
 * The banner slot: the active promo banner, else the Discovery set banner. While the answer is on
 * its way the slot keeps its height, so nothing below it jumps; a failed request shows Discovery.
 */
function BannerSlot() {
  const banner = useBanner();
  if (banner.isPending) return <Skeleton className="min-h-[140px] w-full" rounded="card" />;
  const active = banner.data?.banner;
  return active ? <PromoBanner banner={active} /> : <DiscoveryBanner />;
}

// shrink-0: a long delivery city truncates in the middle; the discs never squeeze into pills
const DISC =
  'grid size-11 shrink-0 place-items-center rounded-pill bg-card text-ink transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95';

/** Home, no welcome screen (approved design): the top block, then the Milk sheet over its edge. */
export function Home() {
  const { t } = usePrefs();
  return (
    <Screen bleed>
      <TopBlock />
      <div
        className="relative -mt-3 flex flex-1 flex-col rounded-t-card bg-ground pt-3"
        style={{
          paddingLeft: 'max(var(--gutter), var(--safe-l, 0px))',
          paddingRight: 'max(var(--gutter), var(--safe-r, 0px))',
        }}
      >
        {/*
          The approved row: search left, avatar right, on white discs, the delivery city between
          them. Search opens the search screen.
        */}
        <div className="flex h-11 items-center justify-between gap-2">
          <Link to="/search" aria-label={t.home.search} className={DISC}>
            <SearchIcon size={20} />
          </Link>
          <DeliveryRow />
          <Link to="/profile" aria-label={t.tabs.profile} className={DISC}>
            <Monogram size={22} />
          </Link>
        </div>
        <div className="mt-4 flex flex-col gap-[var(--section)] pb-4">
          <SearchField />
          <BannerSlot />
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
