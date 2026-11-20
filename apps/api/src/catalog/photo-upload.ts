import { MAX_PHOTO_BYTES } from '@lummi/contracts';
import { HttpException } from '@nestjs/common';
import { looksLikeImage } from './photo-pipeline';

const invalid = (status: number) =>
  new HttpException({ code: 'invalid', fields: ['photo'] }, status);

/**
 * The raw request body of a photo upload (`image/jpeg`, `image/png` or `image/webp`): the type is
 * judged by magic bytes, not by the header or any file name (ADR 0020), and capped at 10 MB.
 * Outside the ts-rest contract because the contract has no raw bodies. Shared by the catalog and
 * the banner photo routes; throws the HTTP error the admin shows.
 */
export function readPhotoBody(body: unknown): Buffer {
  const bytes = Buffer.isBuffer(body) ? body : null;
  if (!bytes || bytes.length === 0) throw invalid(415);
  if (bytes.length > MAX_PHOTO_BYTES) throw invalid(413);
  if (!looksLikeImage(bytes)) throw invalid(415);
  return bytes;
}

/** The HTTP error for a service outcome that refused the photo. */
export function photoFailure(reason: string): HttpException {
  return reason === 'not_found' ? new HttpException({ code: 'not_found' }, 404) : invalid(422);
}
