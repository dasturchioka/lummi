import { openLink, shareURL } from '@telegram-apps/sdk-react';

/**
 * The bot's link, no trailing slash. A deploy build must set `VITE_BOT_LINK` (the Dockerfile refuses an
 * empty one); the dev bot is only the local fallback, never the customer's production bot (ADR 0023).
 */
const botLink = (import.meta.env.VITE_BOT_LINK || 'https://t.me/lummi_dev_bot').replace(/\/$/, '');

/** `p_<slug>` is the Mini App deep link of a fragrance (ADR 0016). */
export const fragranceLink = (slug: string) => `${botLink}?startapp=p_${slug}`;

/** `set_discovery` is the deep link of the Discovery set screen (`STATIC_START_TARGETS`). */
export const discoveryLink = () => `${botLink}?startapp=set_discovery`;

/** Telegram's share sheet; outside Telegram the Web Share API, then the clipboard. */
export const shareFragrance = (slug: string, text: string): Promise<void> =>
  shareLink(fragranceLink(slug), text);

export const shareDiscovery = (text: string): Promise<void> => shareLink(discoveryLink(), text);

async function shareLink(url: string, text: string): Promise<void> {
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
