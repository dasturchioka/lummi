/**
 * lummi-ui-gallery (DEV ONLY): the fragrance card on fixture data, `/dev/fragrance?data=…`.
 * The toggle at the top swaps the fixture at the data boundary (the card props), so the card is
 * tested exactly as the API would feed it. Same marker as the gallery: never in dist.
 */
import { Link, useSearch } from '@tanstack/react-router';
import { FragranceView } from '../screens/fragrance/FragranceView';
import { FIXTURES, type FixtureName } from './fragrance-fixtures';

const NAMES = Object.keys(FIXTURES) as FixtureName[];

export function FragranceFixtures() {
  // The dev routes are outside the typed tree in a build, so the search is read loosely.
  const search: { data?: FixtureName } = useSearch({ strict: false });
  const data = search.data ?? 'worst';
  return (
    <>
      <FragranceView
        key={data}
        card={FIXTURES[data]}
        onBack={() => undefined}
        onShare={() => undefined}
      />
      <nav
        aria-label="fixture"
        className="fixed top-[calc(var(--safe-t,0px)+22px)] left-1/2 z-50 flex -translate-x-1/2 gap-0.5 rounded-pill bg-field p-0.5"
      >
        {NAMES.map((n) => (
          <Link
            key={n}
            to="/dev/fragrance"
            search={{ data: n }}
            replace
            className={`type-caption rounded-pill px-2.5 py-1 ${n === data ? 'bg-card text-ink' : 'text-muted'}`}
          >
            {n}
          </Link>
        ))}
      </nav>
    </>
  );
}
