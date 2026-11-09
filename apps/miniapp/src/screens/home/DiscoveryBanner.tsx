import { usePrefs } from '../../lib/prefs';
import { BoxIcon } from '../../ui/icons';

/**
 * The dark Discovery set banner. The sets ticket gives it its content and its link; until then it
 * is a quiet placeholder slot with the box icon, so the page keeps its approved rhythm.
 */
export function DiscoveryBanner() {
  const { t } = usePrefs();
  return (
    <section
      data-slot="discovery"
      className="flex items-center gap-4 rounded-card bg-totals p-4 text-totals-ink"
    >
      <div className="min-w-0 flex-1">
        <p className="type-section">{t.home.discoveryTitle}</p>
        <p className="type-body mt-1.5 opacity-80">{t.home.discoveryText}</p>
        <span className="type-badge mt-3 inline-block rounded-pill bg-bar-ink/20 px-2.5 py-1.5">
          {t.home.discoverySoon}
        </span>
      </div>
      <div
        aria-hidden="true"
        className="grid size-16 shrink-0 place-items-center rounded-card bg-bar-ink/15 text-bar-ink"
      >
        <BoxIcon size={28} />
      </div>
    </section>
  );
}
