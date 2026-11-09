import { useCatalogPage } from '../../catalog/queries';
import { useOpenFragrance } from '../../lib/navigation';
import { usePrefs } from '../../lib/prefs';
import { FragranceRail } from '../../ui/FragranceRail';
import { SeeAll } from './SeeAll';

/** How many cards the row shows (layout, not a business rule). */
const NEW_COUNT = 8;

/** «Новинки»: the new-flagged fragrances in a row; «Все →» is the catalog sorted by new. */
export default function Novelties() {
  const { t } = usePrefs();
  const open = useOpenFragrance();
  const list = useCatalogPage({ isNew: 1, sort: 'new' }, NEW_COUNT);
  // Every card here is new: the row's title says it, so the cards drop the НОВИНКА badge (DESIGN.md Badges).
  const items = list.data?.items.map((it) => ({ ...it, isNew: false }));
  // A failed or empty row simply is not there; the sections above carry the page.
  if (list.isError || (items && items.length === 0)) return null;
  return (
    <section aria-labelledby="home-new">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-new" className="type-section text-ink">
          {t.home.news}
        </h2>
        <SeeAll search={{ sort: 'new' }} />
      </div>
      <FragranceRail items={items} onSelect={open} label={t.home.news} />
    </section>
  );
}
