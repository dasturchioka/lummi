import { router } from '../app/router';
import { queryClient } from '../app/queryClient';
import { CART_KEY } from '../cart/queries';
import { api } from './api';
import { routeForStartParam } from './startapp';

/**
 * The launch carried `l_<code>` (ticket #35, ADR 0022). The API logs the open, puts the link's
 * promo code in the cart and names the target; the target goes through the same route table as
 * every other `startapp`. An unknown code, or any failure, leaves the shopper on Home: a stale QR
 * never shows an error page. Loaded on demand, so shoppers on plain launches never download it.
 */
export async function openCampaignLaunch(code: string): Promise<void> {
  try {
    const res = await api.campaigns.open({ body: { code } });
    if (res.status !== 200) return;
    // the cart may already be cached without the prefilled code
    void queryClient.invalidateQueries({ queryKey: CART_KEY });
    await router.navigate({ to: routeForStartParam(res.body.target), replace: true });
  } catch {
    /* the shop opens on Home */
  }
}
