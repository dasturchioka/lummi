import { focusManager } from '@tanstack/react-query';
import { on } from '@telegram-apps/sdk-react';

/**
 * What "the app is in the foreground" means for live screens: the page is visible
 * (`visibilitychange`) AND Telegram has not hidden the Mini App (`visibility_changed`, the
 * platform's activated/deactivated). Query's focus is that one flag, recomputed from both signals
 * on every change of either (it stores what it is given, so a single signal would stick). It
 * gates the ~10 s polls and the refetch on resume. Returns the cleanup.
 */
export function installLiveFocus(): () => void {
  let telegramVisible = true;
  const pageVisible = () => document.visibilityState !== 'hidden';
  focusManager.setEventListener((setFocused) => {
    const update = () => setFocused(pageVisible() && telegramVisible);
    document.addEventListener('visibilitychange', update);
    let off: (() => void) | undefined;
    try {
      off = on('visibility_changed', (e) => {
        telegramVisible = e.is_visible;
        update();
      });
    } catch {
      /* outside Telegram, or an old client: the page's own signal is enough */
    }
    return () => {
      document.removeEventListener('visibilitychange', update);
      off?.();
    };
  });
  return () => {
    focusManager.setEventListener(() => undefined);
    focusManager.setFocused(undefined);
  };
}
