import { randomBytes } from 'node:crypto';
import { PROFILE_PHOTO_SIZES } from '@lummi/contracts';
import sharp from 'sharp';
import { looksLikeImage } from '../catalog/photo-pipeline';
import type { FileStore } from '../edges';

/**
 * Profile photos are personal data (#67, ADR 0020 amended): their own FileStore prefix, never
 * `public/`, served by the API only, never by the `media.` host a CDN could sit behind.
 */
export const PROFILE_PHOTO_PREFIX = 'profile-photos/';
export const PROFILE_PHOTO_FILE = /^[a-f0-9]{32}-(96|192|384)\.webp$/;
const WEBP_QUALITY = 82;
/** A decompression-bomb guard, not a rule: no real photo is larger (a 12 MP phone is 12). */
const MAX_INPUT_PIXELS = 40_000_000;

export const profilePhotoKey = (key: string, size: number) =>
  `${PROFILE_PHOTO_PREFIX}${key}-${size}.webp`;

/**
 * Turn a JPEG, PNG or WebP (judged by magic bytes, so SVG, GIF, TIFF and HEIF never reach the
 * decoder, whichever path the bytes came from) into a centred square at each size: decoded once,
 * EXIF orientation applied, every other metadata (EXIF, GPS, ICC) dropped, the source not kept.
 * Each call gets a fresh random 128-bit name, so a photo's URL is unguessable and belongs to one
 * owner; the same bytes from two people share nothing. Null when the bytes are no image.
 */
export async function storeProfilePhoto(
  files: FileStore,
  source: Uint8Array,
): Promise<{ key: string } | null> {
  if (!looksLikeImage(source)) return null;
  const rendered: [number, Buffer][] = [];
  try {
    const decoded = sharp(source, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'warning',
    }).rotate();
    for (const size of PROFILE_PHOTO_SIZES) {
      rendered.push([
        size,
        await decoded
          .clone()
          .resize(size, size, { fit: 'cover', position: 'centre' })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer(),
      ]);
    }
  } catch {
    return null;
  }
  const key = randomBytes(16).toString('hex');
  for (const [size, data] of rendered) await files.put(profilePhotoKey(key, size), data);
  return { key };
}

export async function deleteProfilePhotoFiles(files: FileStore, key: string): Promise<void> {
  for (const size of PROFILE_PHOTO_SIZES) await files.delete(profilePhotoKey(key, size));
}
