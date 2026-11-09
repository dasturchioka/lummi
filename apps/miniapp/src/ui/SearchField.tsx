import { Link } from '@tanstack/react-router';
import { usePrefs } from '../lib/prefs';
import { SearchIcon } from './icons';

/**
 * The «Название или нота» field on Home and the catalog: it looks like the real field (the customer
 * asked for a line, not only a magnifier) but is a link, so a tap opens `/search` and the field there
 * takes the focus and the keyboard.
 */
export function SearchField({ className = '' }: { className?: string }) {
  const { t } = usePrefs();
  return (
    <Link
      to="/search"
      aria-label={t.search.label}
      data-testid="search-field"
      className={`flex h-12 w-full items-center gap-2.5 rounded-btn bg-field px-3.5 text-muted transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99] ${className}`}
    >
      <SearchIcon size={18} />
      <span className="type-row min-w-0 truncate">{t.search.placeholder}</span>
    </Link>
  );
}
