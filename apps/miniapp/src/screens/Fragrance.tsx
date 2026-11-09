import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from '@tanstack/react-router';
import type { CartDto } from '@lummi/contracts';
import { fill } from '@lummi/i18n';
import { useEffect, useState } from 'react';
import { CART_KEY, useAddToCart } from '../cart/queries';
import { hapticSuccess } from '../lib/telegram';
import { api } from '../lib/api';
import { goBackOrCatalog } from '../lib/navigation';
import { usePrefs } from '../lib/prefs';
import { shareFragrance } from '../lib/share';
import { Button } from '../ui/Button';
import { BottleIcon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { FragranceView } from './fragrance/FragranceView';

/** The card's own shape while it loads (photo, lockup, text, icon row, tiles, dock), so nothing jumps. */
function Loading() {
  return (
    <Screen tabBar={false} dock={<Skeleton className="h-12 w-full" />}>
      <div className="flex flex-col pt-3 pb-7" aria-busy="true">
        {/* The photo slot in its own placeholder colour, so the photo arrives without a flash. */}
        <div aria-hidden="true" className="aspect-[3/4] w-full rounded-card bg-photo" />
        <Skeleton className="mt-5 h-3 w-36" />
        <Skeleton className="mt-4 h-3 w-44" />
        <Skeleton className="mt-2 h-6 w-52" />
        <Skeleton className="mt-3.5 h-px w-[72px]" />
        <Skeleton className="mt-3 h-3.5 w-40" />
        <div className="mt-6 flex flex-col gap-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
        <div className="mt-7 grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="size-6" rounded="pill" />
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
        <div className="mt-8 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    </Screen>
  );
}

/** Units of a volume in the cart (0 when none). */
const lineQty = (cart: CartDto | undefined, slug: string, ml: number) =>
  cart?.lines.find((l) => l.slug === slug && l.ml === ml)?.qty ?? 0;

/** `/p/<slug>`, also the target of the `p_<slug>` deep link. */
export function Fragrance() {
  const { slug } = useParams({ from: '/p/$slug' });
  const { t } = usePrefs();
  const router = useRouter();
  const qc = useQueryClient();
  const [note, setNote] = useState<string | undefined>();
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(undefined), 2500);
    return () => clearTimeout(id);
  }, [note]);
  const add = useAddToCart();

  const query = useQuery({
    queryKey: ['fragrance', slug],
    queryFn: async () => {
      const res = await api.catalog.fragrance({ params: { slug } });
      if (res.status === 200) return res.body;
      if (res.status === 404) return null; // unknown or hidden: a state of its own, not an error
      throw new Error(`HTTP ${res.status}`);
    },
  });

  const card = query.data;
  if (query.isError)
    return (
      <Screen tabBar={false}>
        <ErrorState fill retrying={query.isFetching} onRetry={() => void query.refetch()} />
      </Screen>
    );
  if (card === undefined) return <Loading />;
  if (card === null)
    return (
      <Screen tabBar={false}>
        <EmptyState
          fill
          icon={<BottleIcon size={28} />}
          title={t.card.notFoundTitle}
          text={t.card.notFoundText}
          action={
            <Button block onClick={() => void router.navigate({ to: '/catalog', replace: true })}>
              {t.card.toCatalog}
            </Button>
          }
        />
      </Screen>
    );
  return (
    <FragranceView
      // A different fragrance starts on its own first volume.
      key={card.slug}
      card={card}
      onBack={() => goBackOrCatalog(router)}
      onShare={() => void shareFragrance(card.slug, card.name)}
      adding={add.isPending}
      note={note}
      onAddToCart={(ml) => {
        const before = lineQty(qc.getQueryData<CartDto>(CART_KEY), card.slug, ml);
        add.mutate(
          { slug: card.slug, ml },
          {
            onSuccess: (next) => {
              const after = next.lines.find((l) => l.slug === card.slug && l.ml === ml);
              if (after && after.qty <= before) {
                // The server capped it: say how many there are, briefly.
                setNote(fill(t.cart.onlyLeft, { n: String(after.available) }));
              } else {
                hapticSuccess();
              }
            },
            // Stock moved under the customer (409/404): re-read the card so the dock tells the truth.
            onError: () => void qc.invalidateQueries({ queryKey: ['fragrance', card.slug] }),
          },
        );
      }}
    />
  );
}
