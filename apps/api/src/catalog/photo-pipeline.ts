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
