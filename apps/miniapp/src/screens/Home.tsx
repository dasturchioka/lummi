import type { Theme } from '@lummi/contracts';
import { Link } from '@tanstack/react-router';
import { usePrefs } from '../lib/prefs';
import { Logo, Monogram } from '../ui/Logo';
import { Screen } from '../ui/Screen';
import { EmptyState } from '../ui/States';

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
  const { t, theme } = usePrefs();
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
      <div className="flex aspect-[3/2] flex-col items-center px-6 pt-8 text-center">
        <Logo height={24} />
        <span aria-hidden="true" className="mt-4 mb-3.5 h-px w-8 bg-line-strong" />
        <p className="type-section max-w-[26ch] text-balance">{t.home.slogan}</p>
      </div>
    </section>
  );
}

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
        {/* The approved row: search left and delivery city centre arrive with their tickets. */}
        <div className="flex h-11 items-center justify-end">
          <Link
            to="/profile"
            aria-label={t.tabs.profile}
            className="grid size-10 place-items-center rounded-pill bg-block text-ink transition-transform duration-150 active:scale-95"
          >
            <Monogram size={22} />
          </Link>
        </div>
        <EmptyState fill title={t.home.emptyTitle} text={t.home.emptyText} />
      </div>
    </Screen>
  );
}
