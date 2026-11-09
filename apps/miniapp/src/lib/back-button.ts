import {
  hideBackButton,
  isBackButtonMounted,
  mountBackButton,
  onBackButtonClick,
  showBackButton as show,
} from '@telegram-apps/sdk-react';

/** Show Telegram's back button while `visible`; returns the cleanup. A no-op outside Telegram. */
export function showBackButton(visible: boolean, onBack: () => void): () => void {
  try {
    if (!mountBackButton.isAvailable()) return () => undefined;
    if (!isBackButtonMounted()) mountBackButton();
    if (!visible) {
      hideBackButton();
      return () => undefined;
    }
    show();
    const off = onBackButtonClick(onBack);
    return () => {
      off();
      hideBackButton();
    };
  } catch {
    return () => undefined;
  }
}
