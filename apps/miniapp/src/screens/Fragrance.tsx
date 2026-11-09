import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { shareFragrance } from '../lib/share';
import { Button } from '../ui/Button';
import { BottleIcon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { FragranceView } from './fragrance/FragranceView';

function Loading() {
  return (
    <div className="flex flex-col gap-6 pt-3" aria-busy="true">
      <Skeleton className="aspect-[3/4] w-full !rounded-card" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

/** `/p/<slug>`, also the target of the `p_<slug>` deep link. */
export function Fragrance() {
  const { slug } = useParams({ from: '/p/$slug' });
  const { t } = usePrefs();
  const router = useRouter();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['fragrance', slug],
    queryFn: async () => {
      const res = await api.catalog.fragrance({ params: { slug } });
      if (res.status === 200) return res.body;
      if (res.status === 404) return null; // unknown or hidden: a state of its own, not an error
      throw new Error(`HTTP ${res.status}`);
    },
  });

  // From a deep link there is nothing to go back to: land in the catalog instead.
  const goBack = () =>
    router.history.canGoBack()
      ? router.history.back()
      : void navigate({ to: '/catalog', replace: true });

  const card = query.data;
  let body: ReactNode;
  if (query.isError) {
    body = <ErrorState fill retrying={query.isFetching} onRetry={() => void query.refetch()} />;
  } else if (card === undefined) {
    body = <Loading />;
  } else if (card === null) {
    body = (
      <EmptyState
        fill
        icon={<BottleIcon size={28} />}
        title={t.card.notFoundTitle}
        text={t.card.notFoundText}
        action={
          <Button block onClick={() => void navigate({ to: '/catalog', replace: true })}>
            {t.card.toCatalog}
          </Button>
        }
      />
    );
  } else {
    body = (
      <FragranceView
        // A different fragrance starts on its own first volume.
        key={card.slug}
        card={card}
        onBack={goBack}
        onShare={() => void shareFragrance(card.slug, card.name)}
      />
    );
  }
  return <Screen tabBar={false}>{body}</Screen>;
}
