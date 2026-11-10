import { usePrefs } from '../lib/prefs';
import { attribution } from './attribution';

/**
 * The compact name block of a row (DESIGN.md Label Lockup Rule): the caps line «ПО МОТИВАМ <BRAND>»
 * over the Cormorant italic name. Every row that names a fragrance uses it.
 */
export function NameLockup({
  brand,
  name,
  muted = false,
}: {
  brand: string;
  name: string;
  /** A sold-out row: the name steps back. */
  muted?: boolean;
}) {
  const { t } = usePrefs();
  return (
    <>
      <span className="type-label block text-pretty text-muted [overflow-wrap:anywhere]">
        {attribution(t.card.basedOn, brand)}
      </span>
      <span
        className={`type-name mt-px block text-[18px] text-pretty [overflow-wrap:anywhere] ${muted ? 'text-muted' : 'text-ink'}`}
      >
        {name}
      </span>
    </>
  );
}
