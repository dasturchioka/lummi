'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { columnLayout } from './board-state';

/*
 * How much room the board has (#52): its height, its columns' width, whether the screen is wide
 * and whether motion is reduced. Measured in layout effects, so the first paint is already right.
 */

/** The board never gets shorter than this, however little room the viewport leaves. */
const MIN_HEIGHT = 360;
/** Phones: the board fills the screen under the panel's 56 px top bar once scrolled to. */
const PHONE_TOP = 56 + 12;
const WIDE = '(min-width: 640px)';

/**
 * The board's height. From 640 px it fills what the viewport leaves below the board's top
 * (measured), so the whole board is in view without scrolling the page; on phones, whose header
 * takes part of the screen, it fills the screen under the top bar once scrolled to.
 */
export function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const phone = !window.matchMedia(WIDE).matches;
      const top = phone ? PHONE_TOP : el.getBoundingClientRect().top + window.scrollY + 16;
      setHeight(Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - top)));
    };
    measure();
    const watch = new ResizeObserver(measure);
    if (el.parentElement) watch.observe(el.parentElement);
    window.addEventListener('resize', measure);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return { ref, height };
}

/** From 640 px: the columns' width and the room after the last one (`columnLayout`); null on phones. */
export function useColumnLayout(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ width: number; endPad: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setLayout(window.matchMedia(WIDE).matches ? columnLayout(el.clientWidth, count) : null);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [count]);
  return { ref, layout };
}

function useMedia(query: string, fallback: boolean) {
  const [matches, setMatches] = useState(fallback);
  useLayoutEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** From 640 px the closed rails sit beside the scroller; on phones they end it. */
export const useWide = () => useMedia(WIDE, true);

/** The person asked for less motion: fades only, nothing travels (DESIGN.md). */
export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)', false);
