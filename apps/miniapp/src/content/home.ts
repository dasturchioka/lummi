import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

/**
 * What the owner controls on Home, in one answer: the active promo banners in the owner's order
 * (the banner slider's slides after the Discovery set; empty: the Discovery slide alone) and the
 * saved slogan (`null`: the built-in one). One request, so the slogan never swaps in after the
 * first paint.
 */
export function useHomeContent() {
  return useQuery({
    queryKey: ['content', 'home'],
    queryFn: async () => unwrap(await api.content.home(), 200),
    staleTime: 60_000,
  });
}
