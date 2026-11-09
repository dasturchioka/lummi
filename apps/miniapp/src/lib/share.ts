import { openLink, shareURL } from '@telegram-apps/sdk-react';

/** The bot's link, no trailing slash. Dev bot locally via `VITE_BOT_LINK` (ADR 0023). */
const botLink = (import.meta.env.VITE_BOT_LINK ?? 'https://t.me/Lummiuz_bot').replace(/\/$/, '');

/** `p_<slug>` is the Mini App deep link of a fragrance (ADR 0016). */
export const fragranceLink = (slug: string) => `${botLink}?startapp=p_${slug}`;

/** Telegram's share sheet; outside Telegram the Web Share API, then the clipboard. */
export async function shareFragrance(slug: string, text: string): Promise<void> {
  const url = fragranceLink(slug);
  try {
    if (shareURL.isAvailable()) return void shareURL(url, text);
  } catch {
    /* fall through */
  }
  try {
    if (navigator.share) return await navigator.share({ url, text });
    await navigator.clipboard.writeText(url);
  } catch {
    /* the customer dismissed the sheet */
  }
}

/** An external page (the Uzum shop): Telegram's in-app browser, or a new tab outside Telegram. */
export function openExternal(url: string): void {
  try {
    if (openLink.isAvailable()) return openLink(url);
  } catch {
    /* fall through */
  }
  window.open(url, '_blank', 'noopener');
}
