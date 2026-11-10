import { MAX_PHOTO_BYTES } from '@lummi/contracts';
import { HttpException } from '@nestjs/common';
import { looksLikeImage } from '../catalog/photo-pipeline';

/**
 * The raw bytes of an admin photo upload, judged by magic bytes rather than header or file name
 * (ADR 0020) and capped at `MAX_PHOTO_BYTES`. The contract has no raw bodies, so every photo route
 * reads its body here.
 */
export function photoBytes(body: unknown): Buffer {
  const bytes = Buffer.isBuffer(body) ? body : null;
  if (!bytes || bytes.length === 0) {
    throw new HttpException({ code: 'invalid', fields: ['photo'] }, 415);
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new HttpException({ code: 'invalid', fields: ['photo'] }, 413);
  }
  if (!looksLikeImage(bytes)) {
    throw new HttpException({ code: 'invalid', fields: ['photo'] }, 415);
  }
  return bytes;
}
