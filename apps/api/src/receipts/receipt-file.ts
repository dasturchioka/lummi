import type { ReceiptFileKind } from '@lummi/contracts';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { pdfFirstPage, UnreadablePdfError } from './pdf-first-page';

/**
 * The receipt AI's image size (ticket #7, `ReceiptJudge`): TypeSafe takes each side within
 * 280-1568 px. These are the provider's limits, not shop rules, so they are not settings.
 */
export const JUDGE_MIN_SIDE = 280;
export const JUDGE_MAX_SIDE = 1568;
/** A decoded image larger than this is refused before it is decoded (a decompression bomb). */
const MAX_INPUT_PIXELS = 100_000_000;
/** A PDF whose first page takes longer than this to render counts as unreadable. */
const PDF_TIMEOUT_MS = 15_000;
const WHITE = { r: 255, g: 255, b: 255 };

/** The file is the kind it claims by its first bytes, but it does not open. */
export class UnreadableReceiptError extends Error {}

/**
 * JPG, PNG, WebP or PDF by the file's first bytes, never its name or content type (ADR 0020); null
 * for anything else (a GIF, a HEIC photo, a document). A PDF header may sit anywhere in the first
 * kilobyte, as PDF readers allow.
 */
export function receiptKind(b: Uint8Array): ReceiptFileKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (
    b.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => b[i] === byte)
  )
    return 'png';
  if (
    b.length >= 12 &&
    ascii(b, 0, 4) === 'RIFF' &&
    ascii(b, 8, 12) === 'WEBP'
  )
    return 'webp';
  if (Buffer.from(b.subarray(0, 1024)).includes('%PDF-', 0, 'latin1')) return 'pdf';
  return null;
}

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/**
 * The size an image of `width` x `height` takes for the judge: scaled down until no side passes
 * 1568 px, scaled up until no side is under 280 px; a strip too long for both (a very long
 * receipt) keeps its scale and its short side is padded with white to 280 px.
 */
export function judgeFit(width: number, height: number) {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  let scale = Math.min(1, JUDGE_MAX_SIDE / long);
  if (short * scale < JUDGE_MIN_SIDE)
    scale = Math.min(JUDGE_MIN_SIDE / short, JUDGE_MAX_SIDE / long);
  const side = (n: number) => Math.min(JUDGE_MAX_SIDE, Math.max(1, Math.round(n * scale)));
  const w = side(width);
  const h = side(height);
  return {
    width: w,
    height: h,
    canvasWidth: Math.max(w, JUDGE_MIN_SIDE),
    canvasHeight: Math.max(h, JUDGE_MIN_SIDE),
  };
}

export interface NormalizedReceipt {
  data: Buffer;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

/**
 * The image the receipt AI is shown (ADR 0013, 0033): upright (EXIF orientation applied), on white,
 * sized by `judgeFit`, with no metadata (a photo's location stays in the original only). A JPEG
 * stays a JPEG; a PNG, a WebP and the first page of a PDF become PNG.
 */
export async function normalizeReceipt(
  bytes: Uint8Array,
  kind: ReceiptFileKind,
): Promise<NormalizedReceipt> {
  try {
    const source =
      kind === 'pdf'
        ? await pdfFirstPage(bytes, { maxSide: JUDGE_MAX_SIDE, timeoutMs: PDF_TIMEOUT_MS }).then(
            (page) =>
              sharp(page.data, { raw: { width: page.width, height: page.height, channels: 4 } }),
          )
        : sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const meta = await source.metadata();
    if (!meta.width || !meta.height) throw new UnreadableReceiptError('no image size');
    // orientations 5-8 turn the image a quarter: its upright width is the stored height
    const turned = (meta.orientation ?? 1) >= 5;
    const fit = judgeFit(turned ? meta.height : meta.width, turned ? meta.width : meta.height);
    const padX = fit.canvasWidth - fit.width;
    const padY = fit.canvasHeight - fit.height;
    const pipeline = source
      .rotate()
      .resize(fit.width, fit.height, { fit: 'fill' })
      .flatten({ background: WHITE })
      .extend({
        left: Math.floor(padX / 2),
        right: Math.ceil(padX / 2),
        top: Math.floor(padY / 2),
        bottom: Math.ceil(padY / 2),
        background: WHITE,
      });
    const jpeg = kind === 'jpeg';
    const { data, info } = await (jpeg ? pipeline.jpeg({ quality: 90 }) : pipeline.png()).toBuffer({
      resolveWithObject: true,
    });
    return { data, mime: jpeg ? 'image/jpeg' : 'image/png', width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof UnreadablePdfError || e instanceof UnreadableReceiptError)
      throw new UnreadableReceiptError(e.message, { cause: e });
    // sharp refuses a broken or truncated image, or one past the pixel limit
    throw new UnreadableReceiptError(e instanceof Error ? e.message : String(e), { cause: e });
  }
}

/** The original's SHA-256, hex: the same file sent twice is the same receipt (#36). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A 64-bit difference hash of an image, as 16 hex digits: greyscale at 9 x 8, one bit per pair
 * of neighbours (left brighter than right). The same receipt re-saved, re-compressed or rescaled
 * keeps (nearly) the same bits, so #36 can find a repeat by Hamming distance.
 */
export async function differenceHash(image: Uint8Array): Promise<string> {
  const px = await sharp(image)
    .greyscale()
    .resize(9, 8, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      bits = (bits << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}
