import { PHOTO_WIDTHS } from './photo-widths';

/** Product photos: `media.<domain>` in production (ADR 0020), the API's `/media/public` in development. */
const base = import.meta.env.VITE_MEDIA_URL ?? '/api/media/public';

export const photoUrl = (hash: string, width: (typeof PHOTO_WIDTHS)[number]) =>
  `${base}/${hash}-${width}.webp`;

/** `srcset` of the 3:4 WebP set; the browser picks by the slot width and the screen density. */
export const photoSrcSet = (hash: string) =>
  PHOTO_WIDTHS.map((w) => `${photoUrl(hash, w)} ${w}w`).join(', ');
