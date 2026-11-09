import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../lib/api';
import { useOpenFragrance } from '../../lib/navigation';
import { usePrefs } from '../../lib/prefs';
import { FragranceListCard } from '../../ui/FragranceListCard';
import { Skeleton } from '../../ui/Skeleton';

/**
 * «Похожие ароматы» at the foot of the card: the curated ones, then the same family and type, in
 * stock. It loads on its own, so the card never waits for it; a failure or an empty answer simply
 * leaves the section out.
 */
export function Similar({ slug }: { slug: string }) {
  const { t } = usePrefs();
  const open = useOpenFragrance();
  const q = useQuery({
    queryKey: ['catalog', 'similar', slug],
    queryFn: async () => unwrap(await api.catalog.similar({ params: { slug } }), 200).items,
    staleTime: 60_000,
  });
  if (q.isError || (q.data && q.data.length === 0)) return null;
  return (
    <section aria-labelledby="similar" className="mt-8">
      <h2 id="similar" className="type-section mb-3 text-ink">
        {t.card.similar}
      </h2>
      {q.data ? (
        <ul className="flex flex-col gap-2">
          {q.data.map((it) => (
            <li key={it.slug}>
              <FragranceListCard item={it} onSelect={open} />
            </li>
          ))}
        </ul>
      ) : (
        <div aria-hidden="true" className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-card bg-card p-2 pr-3">
              <Skeleton className="aspect-[3/4] w-24 shrink-0" rounded="photo" />
              <div className="flex flex-1 flex-col">
                <Skeleton className="h-2.5 w-1/2" rounded="pill" />
                <Skeleton className="mt-2 h-4 w-3/5" />
                <Skeleton className="mt-4 h-3 w-2/3" />
                <Skeleton className="mt-4 h-3.5 w-2/5" />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
