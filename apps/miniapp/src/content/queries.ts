import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

/** The info pages (Profile list and the page screen); Home never imports this file. */

const TEN_MINUTES = 10 * 60_000;

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
