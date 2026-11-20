import type { FragranceListItem } from '@lummi/contracts';
import { CHIP_ROW } from './Chips';
import { FragranceListCard } from './FragranceListCard';
import { CardSkeleton } from './GridSkeleton';

/**
 * A card's width in a rail: about two and a half cards on a phone, so the next one always peeks in
 * at the edge (DESIGN.md: 158 px). Every item stretches to it, so the cards of a rail line up.
 */
const ITEM = 'flex w-[clamp(148px,42vw,172px)] shrink-0 snap-start *:min-w-0 *:flex-1';

/**
 * A horizontal row of grid cards that scrolls under the screen gutters («Новинки», «Похожие
 * ароматы»). It snaps card by card, with the first card back on the gutter.
 */
export function FragranceRail({
  items,
  onSelect,
  label,
}: {
  /** `undefined` while it loads: three card skeletons. */
  items: FragranceListItem[] | undefined;
  onSelect: (slug: string) => void;
  label: string;
}) {
  if (!items)
    return (
      <div aria-hidden="true" className={`${CHIP_ROW} overflow-hidden pb-1`}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={ITEM}>
            <CardSkeleton />
          </div>
        ))}
      </div>
    );
  return (
    <ul aria-label={label} className={`${CHIP_ROW} snap-x pb-1`}>
      {items.map((it) => (
        <li key={it.slug} className={ITEM}>
          <FragranceListCard item={it} layout="grid" onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
