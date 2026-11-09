import {
  hideBackButton,
  isBackButtonMounted,
  mountBackButton,
  onBackButtonClick,
  showBackButton as show,
} from '@telegram-apps/sdk-react';

/*
 * Who owns Telegram's back button right now: a stack, newest on top. A screen deeper than a tab
 * root pushes "go back"; an open sheet pushes "close me" over it. The button shows while the
 * stack has anything, and a press (or Android's system back) goes to the top entry only, so it
 * closes the sheet instead of leaving the screen or closing the Mini App.
 */
const stack: Array<() => void> = [];
let listening = false;

function sync(): void {
  try {
    if (!mountBackButton.isAvailable()) return;
    if (!isBackButtonMounted()) mountBackButton();
    if (!listening) {
      onBackButtonClick(() => stack.at(-1)?.());
      listening = true;
    }
    if (stack.length) show();
    else hideBackButton();
  } catch {
    /* unsupported in this client */
  }
}

/** Show Telegram's back button while `visible`; returns the cleanup. A no-op outside Telegram. */
export function showBackButton(visible: boolean, onBack: () => void): () => void {
  if (!visible) {
    sync();
    return () => undefined;
  }
  const entry = () => onBack();
  stack.push(entry);
  sync();
  return () => {
    const at = stack.lastIndexOf(entry);
    if (at >= 0) stack.splice(at, 1);
    sync();
  };
}
