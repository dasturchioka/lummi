import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

const TEN_MINUTES = 10 * 60_000;

/** The active Home promo banner, or `{ banner: null }`: Home then shows the Discovery set banner. */
export function useBanner() {
  return useQuery({
    queryKey: ['content', 'banner'],
    queryFn: async () => unwrap(await api.content.banner(), 200),
    staleTime: 60_000,
  });
}

/** The Home slogan as the owner saved it; the built-in string stays until it arrives or when none is saved. */
export function useSlogan() {
  return useQuery({
    queryKey: ['content', 'slogan'],
    queryFn: async () => unwrap(await api.content.slogan(), 200),
    staleTime: TEN_MINUTES,
  });
}

export function useInfoPages() {
  return useQuery({
    queryKey: ['content', 'pages'],
    queryFn: async () => unwrap(await api.content.pages(), 200),
    staleTime: TEN_MINUTES,
  });
}

export function useInfoPage(slug: string) {
  return useQuery({
    queryKey: ['content', 'page', slug],
    queryFn: async () => {
      const res = await api.content.page({ params: { slug } });
      if (res.status === 404) return null;
      return unwrap(res, 200);
    },
    staleTime: TEN_MINUTES,
  });
}
