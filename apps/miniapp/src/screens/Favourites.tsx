import { favouritesMessages } from '@lummi/i18n/favourites';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useFavouriteList } from '../favourites/queries';
import { useOpenFragrance } from '../lib/navigation';
import { usePrefs } from '../lib/prefs';
import { hapticSuccess } from '../lib/telegram';
import { useAddDiscovery, useSetsText } from '../sets/actions';
import { DiscoveryCard } from './sets/SetCards';
import { Button } from '../ui/Button';
import { FragranceGrid } from '../ui/FragranceGrid';
import { CardSkeleton } from '../ui/GridSkeleton';
import { HeartIcon, PlusIcon, Spinner } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { armShopNote, showShopNote } from '../ui/ShopNoteHost';
import { EmptyState, ErrorState } from '../ui/States';

/** The set's quick add, the card's «+» for a box: one tap puts it in the cart. */
function SetAdd() {
  const s = useSetsText();
  const add = useAddDiscovery();
  useEffect(armShopNote, []);
  return (
    <button
      type="button"
      aria-label={s.toCart}
      data-testid="favourite-set-add"
      disabled={add.isPending}
      onClick={() =>
        add.mutate(undefined, {
          onSuccess: () => {
            hapticSuccess();
            showShopNote(s.added);
          },
          onError: () => showShopNote(s.soldOut),
        })
      }
      className="absolute right-3 bottom-3 z-10 grid size-8 place-items-center rounded-btn bg-btn text-btn-ink transition-[scale,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] after:absolute after:-inset-1.5 hover:opacity-90 active:scale-95 disabled:opacity-100"
    >
      {add.isPending ? <Spinner size={16} /> : <PlusIcon size={18} />}
    </button>
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
          {data.discoverySet ? (
            <div className="mb-2">
              <DiscoveryCard extra={data.discoverySet.soldOut ? null : <SetAdd />} />
            </div>
          ) : null}
          {data.items.length > 0 ? (
            <FragranceGrid items={data.items} onSelect={open} label={f.title} />
          ) : null}
        </>
      )}
    </Screen>
  );
}
