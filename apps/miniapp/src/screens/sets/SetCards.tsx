import { DISCOVERY_FAVOURITE, MAIN_SET_KEY, setRoute } from '@lummi/contracts/constants';
import type { ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { usePrefs } from '../../lib/prefs';
import { useSetsText } from '../../sets/actions';
import { useDiscoverySet, useDiscoverySets } from '../../sets/queries';
import { HeartButton } from '../../ui/HeartButton';
import { ChevronIcon } from '../../ui/icons';
import { Money } from '../../ui/Money';
import { SetPhoto } from '../../ui/SetPhoto';
import { SetTray } from '../../ui/SetTray';

/**
 * The «Наборы» chip's page: the builder and every Discovery set on sale (ADR 0042, 0044), each one
 * tap from its own screen. The builder costs the main set's price (ADR 0009).
 */
const CARD =
  'flex w-full items-center gap-3 rounded-card bg-card p-3 text-left transition-[background-color,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] active:bg-field';

/**
 * A Discovery set's card: its photo, own name, price and stock, the heart (the main set's only), a
 * chevron. `extra` is placed over it (the favourites' «+»).
 */
export function DiscoveryCard({
  extra,
  setKey = MAIN_SET_KEY,
}: {
  extra?: ReactNode;
  setKey?: string;
}) {
  const { t, language } = usePrefs();
  const s = useSetsText();
  const navigate = useNavigate();
  const set = useDiscoverySet(setKey).data;
  const extras = setKey === MAIN_SET_KEY;
  // the owner's name (ADR 0044); the lead says what its box holds
  const title = set?.name[language] ?? '';
  const lead = s.discovery[set?.vialMl ?? 10].lead;
  return (
    <div className="relative">
      <button
        type="button"
        data-testid={`${setKey}-card`}
        onClick={() => void navigate({ to: setRoute(setKey) })}
        className={CARD}
      >
        <span
          aria-hidden="true"
          className="relative aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-thumb bg-photo"
        >
          <SetPhoto hash={set?.photo ?? null} sizes="80px" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="type-label block text-muted">{t.home.discoveryLabel}</span>
          <span className="type-name-lg mt-0.5 block text-ink [overflow-wrap:anywhere]">
            {title}
          </span>
          <span className="type-small mt-1 block text-pretty text-muted">{lead}</span>
          <span className="mt-2 flex min-h-5 items-center gap-2">
            {set ? <Money amount={set.price} /> : null}
            {set?.soldOut ? <span className="type-caption text-muted">{s.soldOut}</span> : null}
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted">
          <ChevronIcon size={16} />
        </span>
      </button>
      {/* the heart takes the card's top-right corner (the box photo is too narrow to keep it off its
        wordmark), a sibling of the card button */}
      {extras ? (
        <HeartButton
          target={DISCOVERY_FAVOURITE}
          name={title}
          place="corner"
          className="top-2 right-2"
        />
      ) : null}
      {extra}
    </div>
  );
}

export function SetCards() {
  const { t } = usePrefs();
  const s = useSetsText();
  const navigate = useNavigate();
  const set = useDiscoverySet().data;
  const sets = useDiscoverySets().data ?? [];
  return (
    <ul aria-label={s.setsLabel} className="flex flex-col gap-2">
      <li>
        <button
          type="button"
          data-testid="builder-card"
          onClick={() => void navigate({ to: '/sets/builder' })}
          className={CARD}
        >
          {/* the box from above, its five compartments still empty: the builder is the box to fill */}
          <span
            aria-hidden="true"
            className="relative aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-thumb"
          >
            <SetTray />
          </span>
          {/* named as the Discovery set beside it: «НАБОР» over the set's name, then what it holds */}
          <span className="min-w-0 flex-1">
            <span className="type-label block text-muted">{t.home.discoveryLabel}</span>
            <span className="type-name-lg mt-0.5 block text-ink [overflow-wrap:anywhere]">
              {s.builderTitle}
            </span>
            <span className="type-small mt-1 block text-pretty text-muted">
              {s.builderCardText}
            </span>
            <span className="mt-2 block min-h-5">{set ? <Money amount={set.price} /> : null}</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-muted">
            <ChevronIcon size={16} />
          </span>
        </button>
      </li>
      {sets.map((d) => (
        <li key={d.key}>
          <DiscoveryCard setKey={d.key} />
        </li>
      ))}
    </ul>
  );
}
