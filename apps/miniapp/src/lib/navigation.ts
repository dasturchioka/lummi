import { useNavigate, type useRouter } from '@tanstack/react-router';

/**
 * Back one screen, or to the catalog when there is nothing to go back to (a `p_<slug>` deep link
 * opened the app straight on this screen). Telegram's back button and the in-page back share it.
 */
export function goBackOrCatalog(router: ReturnType<typeof useRouter>): void {
  if (router.history.canGoBack()) router.history.back();
  else void router.navigate({ to: '/catalog', replace: true });
}

/** Opens a fragrance card; every list (search, catalog, Home, similar) goes through this one. */
export function useOpenFragrance(): (slug: string) => void {
  const navigate = useNavigate();
  return (slug) => void navigate({ to: '/p/$slug', params: { slug } });
}
