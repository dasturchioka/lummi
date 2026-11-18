import { PROFILE_PHOTO_SIZES } from '@lummi/contracts/constants';
import { PHOTO_WIDTHS } from './photo-widths';

/** Product photos: `media.<domain>` in production (ADR 0020), the API's `/media/public` in development. */
const base = import.meta.env.VITE_MEDIA_URL ?? '/api/media/public';

export const photoUrl = (hash: string, width: (typeof PHOTO_WIDTHS)[number]) =>
  `${base}/${hash}-${width}.webp`;

/**
 * Profile photos are personal data (#67): served by the API itself, never by the media host.
 * Square 96 / 192 / 384 px WebP of one random name per photo.
 */
const apiBase = import.meta.env.VITE_API_URL ?? '/api';
export const profilePhotoUrl = (key: string, size: (typeof PROFILE_PHOTO_SIZES)[number]) =>
  `${apiBase}/profile-photos/${key}-${size}.webp`;
export const profilePhotoSrcSet = (key: string) =>
  PROFILE_PHOTO_SIZES.map((s) => `${profilePhotoUrl(key, s)} ${s}w`).join(', ');

/** `srcset` of the 3:4 WebP set; the browser picks by the slot width and the screen density. */
export const photoSrcSet = (hash: string) =>
  PHOTO_WIDTHS.map((w) => `${photoUrl(hash, w)} ${w}w`).join(', ');
