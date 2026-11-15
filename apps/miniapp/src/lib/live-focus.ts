import { focusManager } from '@tanstack/react-query';
import { on } from '@telegram-apps/sdk-react';

/**
 * What "the app is in the foreground" means for live screens: the page is visible
 * (`visibilitychange`) and Telegram has not hidden the Mini App (`visibility_changed`, the
 * platform's activated/deactivated). Query's focus is that one flag: it gates the ~10 s polls and
 * refetches on resume. Returns the cleanup.
 */
export function installLiveFocus(): () => void {
  focusManager.setEventListener((setFocused) => {
    const onPage = () => setFocused(); // undefined: read document.visibilityState
    document.addEventListener('visibilitychange', onPage);
    let off: (() => void) | undefined;
    try {
      off = on('visibility_changed', (e) => setFocused(e.is_visible));
    } catch {
      /* outside Telegram, or an old client: the page's own signal is enough */
    }
    return () => {
      document.removeEventListener('visibilitychange', onPage);
      off?.();
    };
  });
  return () => focusManager.setEventListener(() => undefined);
}
