import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { FileStore } from '../edges';
import { PUBLIC_PREFIX } from '../catalog/photo-pipeline';

/** Side lengths of the square WebP renditions of a profile photo (#67): 96 for lists, 192 and 384 for @2x/@3x. */
export const AVATAR_SIZES = [96, 192, 384] as const;
const WEBP_QUALITY = 82;
export const AVATAR_FILE = /^avatar-[a-f0-9]{32}-(96|192|384)\.webp$/;

export const avatarKey = (hash: string, size: number) =>
  `${PUBLIC_PREFIX}avatar-${hash}-${size}.webp`;

/**
 * Turn an uploaded or Telegram photo into the served set: a centred square at 96/192/384, EXIF
 * orientation applied, metadata dropped. The source itself is not kept (personal data; nothing
 * needs it). The name is a content hash of the largest rendition, so a changed photo gets a new
 * URL and the same photo from two people shares files. Null when the bytes are not an image.
 */
export async function storeAvatar(
  files: FileStore,
  source: Uint8Array,
): Promise<{ hash: string } | null> {
  const renditions: [number, Buffer][] = [];
  try {
    for (const size of AVATAR_SIZES) {
      renditions.push([
        size,
        await sharp(source)
          .rotate()
          .resize(size, size, { fit: 'cover', position: 'centre' })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer(),
      ]);
    }
  } catch {
    return null;
  }
  const largest = renditions.at(-1)![1];
  const hash = createHash('sha256').update(largest).digest('hex').slice(0, 32);
  for (const [size, data] of renditions) await files.put(avatarKey(hash, size), data);
  return { hash };
}

export async function deleteAvatarFiles(files: FileStore, hash: string): Promise<void> {
  for (const size of AVATAR_SIZES) await files.delete(avatarKey(hash, size));
}
