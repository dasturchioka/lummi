import { Link } from '@tanstack/react-router';
import type { FragranceType } from '../../catalog/filters';
import { usePrefs } from '../../lib/prefs';

/** «Все →» at the end of a section's title line. */
export function SeeAll({ search }: { search: { type?: FragranceType; sort?: 'new' } }) {
  const { t } = usePrefs();
  return (
    <Link
      to="/catalog"
      search={search}
      className="type-small -my-2 flex items-center gap-1 py-2 pl-2 font-medium text-ink"
    >
      {t.home.all}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
