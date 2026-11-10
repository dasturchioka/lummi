import { openTelegramLink } from '@telegram-apps/sdk-react';
import { isTelegramLink } from '@lummi/rich-text';
import { openExternal } from './share';
import { isMocked } from './telegram';

/**
 * Opens a link from the owner's rich text and returns true when it handled it (the caller then
 * stops the anchor's own navigation): t.me / tg: links through Telegram, other https links in its
 * in-app browser. mailto: and tel: return false and are left to the system.
 */
export function openContentLink(href: string): boolean {
  if (/^(?:mailto|tel):/i.test(href)) return false;
  if (href.startsWith('https:') && isTelegramLink(href)) {
    try {
      if (openTelegramLink.isAvailable() && !isMocked()) {
        openTelegramLink(href);
        return true;
      }
    } catch {
      /* fall through */
    }
  }
  openExternal(href);
  return true;
}
