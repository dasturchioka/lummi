/** Mirrors `apps/api/src/catalog/photo-pipeline.ts`: the widths of the rendered WebP set… */
export const PHOTO_WIDTHS = [400, 800, 1200] as const;
/** …and its 3:4 shape (height = width × 4 / 3, rounded like the pipeline). */
export const photoHeight = (width: number) => Math.round((width * 4) / 3);
