import { useNavigate } from '@tanstack/react-router';
import { usePrefs } from '../../lib/prefs';
import { useSetsText } from '../../sets/actions';
import { useDiscoverySet } from '../../sets/queries';
import { ChevronIcon } from '../../ui/icons';
import { Money } from '../../ui/Money';
import { SetPhoto } from '../../ui/SetPhoto';
import { SetTray } from '../../ui/SetTray';

/**
 * The «Наборы» chip's page: the Discovery set and the builder, each one tap from its own screen.
 * Both cost the Discovery set's price (ADR 0009).
 */
export function SetCards() {
  const { t } = usePrefs();
  const s = useSetsText();
  const navigate = useNavigate();
  const set = useDiscoverySet().data;
  const card =
    'flex w-full items-center gap-3 rounded-card bg-card p-3 text-left transition-[background-color,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] active:bg-field';
  return (
    <ul aria-label={s.setsLabel} className="flex flex-col gap-2">
      <li>
        <button
          type="button"
          data-testid="discovery-card"
          onClick={() => void navigate({ to: '/sets/discovery' })}
          className={card}
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
              {s.discoveryTitle}
            </span>
            <span className="type-small mt-1 block text-pretty text-muted">{s.discoveryLead}</span>
            <span className="mt-2 flex min-h-5 items-center gap-2">
              {set ? <Money amount={set.price} /> : null}
              {set?.soldOut ? <span className="type-caption text-muted">{s.soldOut}</span> : null}
            </span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-muted">
            <ChevronIcon size={16} />
          </span>
        </button>
      </li>
      <li>
        <button
          type="button"
          data-testid="builder-card"
          onClick={() => void navigate({ to: '/sets/builder' })}
          className={card}
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
    </ul>
  );
}
