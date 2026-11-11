import type { FavouriteIds } from '@lummi/contracts';
import { DISCOVERY_FAVOURITE } from '@lummi/contracts/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

/** `['favourites', 'ids']` is the hearts' query, `['favourites', 'list']` the page's (same prefix). */
export const FAVOURITES_KEY = ['favourites'] as const;
const IDS_KEY = ['favourites', 'ids'] as const;

/**
 * The slugs every heart reads: one small request, shared by all cards (ticket #45, ADR 0030
 * budget: this file and the heart are the only favourites code on the first screen).
 */
export function useFavouriteIds() {
  return useQuery({
    queryKey: IDS_KEY,
    staleTime: 60_000,
    queryFn: async () => unwrap(await api.favourites.ids(), 200),
  });
}

type Toggle = { target: string; on: boolean };

function apply(ids: FavouriteIds | undefined, { target, on }: Toggle): FavouriteIds | undefined {
  if (!ids) return ids;
  if (target === DISCOVERY_FAVOURITE) return { ...ids, discoverySet: on };
  const rest = ids.slugs.filter((s) => s !== target);
  return { ...ids, slugs: on ? [target, ...rest] : rest };
}

/**
 * Hearts and un-hearts a target at once; the server's answer (idempotent) replaces the guess, and a
 * failure puts back just that target (another heart tapped meanwhile keeps its own change).
 */
export function useToggleFavourite() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: FAVOURITES_KEY,
    mutationFn: async ({ target, on }: Toggle) =>
      unwrap(
        await (on
          ? api.favourites.add({ params: { target } })
          : api.favourites.remove({ params: { target } })),
        200,
      ),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: IDS_KEY });
      qc.setQueryData<FavouriteIds>(IDS_KEY, (ids) => apply(ids, v));
    },
    onError: (_e, v) =>
      qc.setQueryData<FavouriteIds>(IDS_KEY, (ids) => apply(ids, { ...v, on: !v.on })),
    // the last toggle in flight settles both the hearts and the page's list
    onSettled: () => {
      if (qc.isMutating({ mutationKey: FAVOURITES_KEY }) === 1)
        void qc.invalidateQueries({ queryKey: FAVOURITES_KEY });
    },
  });
}

/** The page's cards: today's price and stock, newest saved first. Lazy, with the screen. */
export function useFavouriteList() {
  return useQuery({
    queryKey: ['favourites', 'list'] as const,
    staleTime: 0,
    queryFn: async () => unwrap(await api.favourites.list(), 200),
  });
}
