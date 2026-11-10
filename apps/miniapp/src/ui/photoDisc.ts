/** The ease the app's small motions share. */
export const EASE_OUT = 'ease-[cubic-bezier(0.23,1,0.32,1)]';

/**
 * The overlay disc on the photo (DESIGN.md Elevation): 92% Milk with a Graphite icon in both
 * themes, because the bottle photo is light in both. 40 px, with a 48 px tap area around it.
 */
export const DISC = `relative grid size-10 place-items-center rounded-pill bg-photo-disc text-photo-disc-ink transition-transform duration-150 ${EASE_OUT} after:absolute after:-inset-1 active:scale-95`;
