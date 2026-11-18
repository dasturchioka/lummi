import { PHOTO_WIDTHS } from './photo-widths';

/** Product photos: `media.<domain>` in production (ADR 0020), the API's `/media/public` in development. */
const base = import.meta.env.VITE_MEDIA_URL ?? '/api/media/public';

export const photoUrl = (hash: string, width: (typeof PHOTO_WIDTHS)[number]) =>
  `${base}/${hash}-${width}.webp`;

/** Profile photos: square 96 / 192 / 384 px WebP renditions of one content hash (#67). */
export const AVATAR_SIZES = [96, 192, 384] as const;
export const avatarUrl = (hash: string, size: (typeof AVATAR_SIZES)[number]) =>
  `${base}/avatar-${hash}-${size}.webp`;
export const avatarSrcSet = (hash: string) =>
  AVATAR_SIZES.map((s) => `${avatarUrl(hash, s)} ${s}w`).join(', ');

/** `srcset` of the 3:4 WebP set; the browser picks by the slot width and the screen density. */
export const photoSrcSet = (hash: string) =>
  PHOTO_WIDTHS.map((w) => `${photoUrl(hash, w)} ${w}w`).join(', ');
