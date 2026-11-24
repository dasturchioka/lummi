'use client';

import { useEffect, type RefObject } from 'react';

/*
 * The board's sideways scroll with a mouse (feedback 2026-11-25: «горизонтальный скролл трудно
 * использовать»). A plain wheel only scrolls up and down, and the columns' own lists take it, so
 * the board only moved with Shift + wheel or its thin scrollbar. Now:
 *  - the wheel over the board moves it sideways, except over a column whose cards scroll (that
 *    column keeps the wheel, as on Trello);
 *  - a press-and-drag on the board's background (a column's head, its empty tray, the gaps) pans
 *    it, while a press on a card still carries the card (dnd-kit).
 */

/** A press on these is theirs (a card is carried, a link followed), never a pan. */
const NOT_BACKGROUND = '[data-order], a, button, input, select, textarea, [role="button"]';
/** A press becomes a pan only past this, so a click on the background stays a click. */
const PAN_SLOP = 4;
/** A wheel line (Firefox's `deltaMode` 1) in px. */
const LINE = 40;

export function useBoardPan(scroller: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) return;
    const canScrollX = () => el.scrollWidth > el.clientWidth + 1;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || !canScrollX()) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // a trackpad's own sideways swipe
      const list = (e.target as Element | null)?.closest('.board-list');
      if (list && list.scrollHeight > list.clientHeight + 1) return;
      e.preventDefault();
      el.scrollLeft +=
        e.deltaY * (e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? el.clientWidth : 1);
    };

    let start: { x: number; left: number; id: number } | null = null;
    let panning = false;
    const stop = () => {
      start = null;
      if (panning) {
        panning = false;
        el.removeAttribute('data-panning');
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      if (!panning) {
        if (Math.abs(dx) < PAN_SLOP) return;
        panning = true;
        el.setAttribute('data-panning', '');
      }
      e.preventDefault();
      el.scrollLeft = start.left - dx;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !canScrollX()) return;
      if (el.hasAttribute('data-carrying')) return;
      if ((e.target as Element | null)?.closest(NOT_BACKGROUND)) return;
      start = { x: e.clientX, left: el.scrollLeft, id: e.pointerId };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    };
    // the pan must not also select the column heads' text
    const onSelect = (e: Event) => {
      if (panning) e.preventDefault();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    document.addEventListener('selectstart', onSelect);
    return () => {
      stop();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      document.removeEventListener('selectstart', onSelect);
    };
  }, [scroller, enabled]);
}
