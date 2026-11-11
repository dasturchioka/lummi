import { DISCOVERY_FAVOURITE } from '@lummi/contracts/constants';
import { favouritesMessages } from '@lummi/i18n/favourites';
import { useRouter } from '@tanstack/react-router';
import { useFavouriteList } from '../favourites/queries';
import { useOpenFragrance } from '../lib/navigation';
import { usePrefs } from '../lib/prefs';
import { useSetsText } from '../sets/actions';
import { Button } from '../ui/Button';
import { FragranceGrid } from '../ui/FragranceGrid';
import { CardSkeleton } from '../ui/GridSkeleton';
import { HeartButton } from '../ui/HeartButton';
import { HeartIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { SetPhoto } from '../ui/SetPhoto';
import { EmptyState, ErrorState } from '../ui/States';

/** The Discovery set among the favourites: its photo, today's price and stock; the card opens its screen. */
function FavouriteSet({ set }: { set: { price: number; soldOut: boolean; photo: string | null } }) {
  const { t } = usePrefs();
  const s = useSetsText();
  const router = useRouter();
  return (
    <div className="relative mb-2 flex items-center gap-3 rounded-card bg-card p-2 pr-3">
      <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-photo bg-photo">
        <SetPhoto hash={set.photo} sizes="96px" />
        <HeartButton target={DISCOVERY_FAVOURITE} name={s.discoveryTitle} />
      </div>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-label text-muted">{t.home.discoveryLabel}</span>
        <span className="type-name mt-0.5 text-ink [overflow-wrap:anywhere]">
          {s.discoveryTitle}
        </span>
        <span className="mt-1.5 flex min-h-[30px] items-center">
          {set.soldOut ? (
            <span className="type-small text-muted">{s.soldOut}</span>
          ) : (
            <Money amount={set.price} />
          )}
        </span>
      </span>
      <button
        type="button"
        aria-label={s.discoveryTitle}
        data-testid="favourite-set"
        onClick={() => void router.navigate({ to: '/sets/discovery' })}
        className="absolute inset-0 rounded-card"
      />
    </div>
  );
}

/** Profile → «Избранное»: the saved fragrances (and the Discovery set) as list cards, newest saved first. */
export function Favourites() {
  const { language } = usePrefs();
  const f = favouritesMessages[language].favourites;
  const router = useRouter();
  const open = useOpenFragrance();
  const list = useFavouriteList();

  if (list.isError && !list.data) {
    return (
      <Screen>
        <ScreenHeader title={f.title} />
        <ErrorState fill onRetry={list.refetch} retrying={list.isFetching} />
      </Screen>
    );
  }
  const data = list.data;
  return (
    <Screen>
      <ScreenHeader title={f.title} />
      {!data ? (
        <ul role="status" aria-label={f.loadingLabel} className="grid grid-cols-2 gap-2">
          {[0, 1].map((i) => (
            <li key={i}>
              <CardSkeleton />
            </li>
          ))}
        </ul>
      ) : data.items.length === 0 && !data.discoverySet ? (
        <EmptyState
          fill
          icon={<HeartIcon size={28} />}
          title={f.emptyTitle}
          text={f.emptyText}
          action={
            <Button block onClick={() => void router.navigate({ to: '/catalog' })}>
              {f.toCatalog}
            </Button>
          }
        />
      ) : (
        <>
          {data.discoverySet ? <FavouriteSet set={data.discoverySet} /> : null}
          {data.items.length > 0 ? (
            <FragranceGrid items={data.items} onSelect={open} label={f.title} />
          ) : null}
        </>
      )}
    </Screen>
  );
}
