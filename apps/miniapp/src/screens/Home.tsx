import { Link } from '@tanstack/react-router';
import { usePrefs } from '../lib/prefs';
import { Logo, Monogram } from '../ui/Logo';
import { EmptyState } from '../ui/States';

/**
 * Home, no welcome screen (approved design). The top block is where the fabric photo goes
 * (light and dark variants, still to come from the design source); until then it is Stone.
 */
export function Home() {
  const { t } = usePrefs();
  return (
    <main
      className="mx-auto w-full max-w-[520px]"
      style={{
        paddingBottom:
          'calc(var(--tabbar-h) + var(--tabbar-inset) * 2 + var(--safe-b, 0px) + 16px)',
      }}
    >
      <section
        data-slot="fabric"
        className="relative flex h-[216px] flex-col items-center justify-center gap-3 bg-block px-6 text-center text-ink"
        style={{ paddingTop: 'var(--safe-t, 0px)' }}
      >
        <Link
          to="/profile"
          aria-label={t.tabs.profile}
          className="absolute right-4 grid size-10 place-items-center rounded-pill bg-ground text-ink"
          style={{ top: 'calc(12px + var(--safe-t, 0px))' }}
        >
          <Monogram size={22} />
        </Link>
        <Logo height={16} />
        <p className="type-body text-ink">{t.home.slogan}</p>
      </section>
      <div className="relative -mt-5 rounded-t-card bg-ground px-4 pt-6">
        <EmptyState title={t.home.emptyTitle} text={t.home.emptyText} />
      </div>
    </main>
  );
}
