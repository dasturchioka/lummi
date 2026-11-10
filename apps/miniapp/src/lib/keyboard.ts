import { useEffect, useState } from 'react';

const TEXT_INPUTS = new Set(['text', 'search', 'tel', 'email', 'url', 'number', 'password']);

/** A field the software keyboard opens for. */
function takesKeyboard(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.has(el.type) && !el.readOnly;
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * The software keyboard is up, or coming: a text field has the focus on a touch screen, or
 * Telegram's WebView (its visual viewport) has shrunk to under three quarters of its tallest
 * height at this width. The shell hides the floating tab bar meanwhile, as native apps do, so the
 * bar never rides the keyboard over the field and the totals.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const touch = window.matchMedia('(pointer: coarse)');
    const size = () => ({ w: vv?.width ?? window.innerWidth, h: vv?.height ?? window.innerHeight });
    let tallest = size();
    const check = () => {
      const now = size();
      // a new width (a rotation, a resized desktop window) starts the measure again
      if (Math.abs(now.w - tallest.w) > 1 || now.h > tallest.h) tallest = now;
      setOpen((touch.matches && takesKeyboard(document.activeElement)) || now.h < tallest.h * 0.75);
    };
    // focus lands after `focusout`: read where it went on the next frame
    const afterBlur = () => requestAnimationFrame(check);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', afterBlur);
    vv?.addEventListener('resize', check);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', afterBlur);
      vv?.removeEventListener('resize', check);
    };
  }, []);
  return open;
}
