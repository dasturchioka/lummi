import { fill, type Language } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
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
    if (res.body.promoCodePrefilled) await sayCodeWaits();
  } catch {
    /* the shop opens on Home */
  }
}

/**
 * A quiet line on the target screen: the link's code is already in the cart. Once per open, and
 * not when the quote refused the code (the cart then says why). Plain DOM, so the line costs the
 * entry bundle nothing; it fades by itself.
 */
async function sayCodeWaits(): Promise<void> {
  const cart = await api.cart.get();
  const code = cart.status === 200 ? cart.body.quote.promoCode : null;
  if (!code || code.invalid) return;
  const lang = (document.documentElement.lang === 'uz' ? 'uz' : 'ru') satisfies Language;
  const note = document.createElement('p');
  note.setAttribute('role', 'status');
  note.dataset.testid = 'campaign-note';
  note.textContent = fill(miniappMessages[lang].cart.promo.inCart, { code: code.code });
  note.style.cssText =
    'position:fixed;left:16px;right:16px;top:calc(env(safe-area-inset-top,0px) + 12px);z-index:50;' +
    'margin:0 auto;max-width:358px;padding:10px 14px;border-radius:10px;text-align:center;' +
    'font:500 14px/1.35 Manrope,system-ui,sans-serif;color:var(--c-sage-ink);' +
    'background:var(--c-card);border:1px solid var(--c-sage);transition:opacity 300ms ease-out;';
  document.body.append(note);
  setTimeout(() => (note.style.opacity = '0'), 4000);
  setTimeout(() => note.remove(), 4400);
}
