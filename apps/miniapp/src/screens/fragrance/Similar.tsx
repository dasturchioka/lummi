import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../lib/api';
import { useOpenFragrance } from '../../lib/navigation';
import { usePrefs } from '../../lib/prefs';
import { FragranceRail } from '../../ui/FragranceRail';

/**
 * «Похожие ароматы» at the foot of the card: the curated ones, then the same family and type, in
 * stock. A row of grid cards, like «Новинки» on Home, so up to six of them cost one card's height
 * rather than a second page under the card. It loads on its own, so the card never waits for it;
 * a failure or an empty answer simply leaves the section out.
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
    <section aria-labelledby="similar" className="mt-9">
      <h2 id="similar" className="type-section mb-3 text-ink">
        {t.card.similar}
      </h2>
      <FragranceRail items={q.data} onSelect={open} label={t.card.similar} />
    </section>
  );
}
