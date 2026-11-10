import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { FileStore } from '../edges';

/** Widths of the rendered 3:4 WebP set (ADR 0020). The Mini App serves them with `srcset`. */
export const PHOTO_WIDTHS = [400, 800, 1200] as const;
const RATIO = 4 / 3;
const WEBP_QUALITY = 82;
/** Public product photos live under this prefix of the FileStore (`/media/public` on the VPS). */
export const PUBLIC_PREFIX = 'public/';
export const PHOTO_FILE = /^[a-f0-9]{16}-(400|800|1200)\.webp$/;

export const photoKey = (hash: string, width: number) => `${PUBLIC_PREFIX}${hash}-${width}.webp`;

/**
 * Turn an uploaded bottle photo into the served set: 3:4 WebP at 400/800/1200 named by content hash,
 * the source kept untouched under `originals/` (a PNG stays a PNG). Same bytes in, same names out,
 * so re-running is harmless and a changed photo gets a new URL (immutable caching never goes stale).
 */
export async function storePhoto(files: FileStore, source: Uint8Array): Promise<{ hash: string }> {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const meta = await sharp(source).metadata();
  const ext = meta.format === 'jpeg' ? 'jpg' : (meta.format ?? 'bin');
  await files.put(`originals/${hash}.${ext}`, source);
  for (const width of PHOTO_WIDTHS) {
    const out = await sharp(source)
      .resize(width, Math.round(width * RATIO), { fit: 'cover', position: 'centre' })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    await files.put(photoKey(hash, width), out);
  }
  return { hash };
}

/** JPEG, PNG or WebP by their first bytes. */
export function looksLikeImage(b: Uint8Array): boolean {
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const webp =
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50;
  return jpeg || png || webp;
}

/** The smallest upload that does not upscale the 400 px rendition (3:4). */
export const MIN_PHOTO = { width: 400, height: 533 } as const;

/**
 * Judges an uploaded photo's dimensions and stores its renditions; null when it is unreadable or
 * too small. The one path for every admin photo upload (bottles, the Discovery set).
 */
export async function storeUploadedPhoto(
  files: FileStore,
  bytes: Uint8Array,
): Promise<string | null> {
  try {
    const meta = await sharp(bytes).metadata();
    if ((meta.width ?? 0) < MIN_PHOTO.width || (meta.height ?? 0) < MIN_PHOTO.height) return null;
    return (await storePhoto(files, bytes)).hash;
  } catch {
    return null;
  }
}
