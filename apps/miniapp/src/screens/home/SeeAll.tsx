import { Link } from '@tanstack/react-router';
import type { FragranceType } from '../../catalog/filters';
import { usePrefs } from '../../lib/prefs';
import { ArrowRightIcon } from '../../ui/icons';

/** «Все →» at the end of a section's title line. */
export function SeeAll({ search }: { search: { type?: FragranceType; sort?: 'new' } }) {
  const { t } = usePrefs();
  return (
    <Link
      to="/catalog"
      search={search}
      className="type-small -my-3 -mr-2 flex min-h-11 items-center gap-1 py-3 pr-2 pl-3 font-medium text-ink transition-opacity duration-150 active:opacity-60"
    >
      {t.home.all}
      <ArrowRightIcon size={14} />
    </Link>
  );
}
