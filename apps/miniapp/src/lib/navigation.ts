import type { useRouter } from '@tanstack/react-router';

/**
 * Back one screen, or to the catalog when there is nothing to go back to (a `p_<slug>` deep link
 * opened the app straight on this screen). Telegram's back button and the in-page back share it.
 */
export function goBackOrCatalog(router: ReturnType<typeof useRouter>): void {
  if (router.history.canGoBack()) router.history.back();
  else void router.navigate({ to: '/catalog', replace: true });
}
