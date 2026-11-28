import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Edges } from '../edges';
import { EDGES } from '../tokens';
import { PHOTO_FILE, PUBLIC_PREFIX } from './photo-pipeline';

/**
 * Product photos (never profile photos, which are personal data and have their own API route,
 * `ProfilePhotoMediaController`) for development and tests. In production Caddy serves the same files on
 * `media.<domain>` with the same header (ADR 0020), from `FILES_DIR/public` only, never from
 * `FILES_DIR` itself: receipts live beside it under `private/` and are served only through the API
 * (#28). Names are content hashes, so a file never changes and may be cached forever.
 */
@Controller('media/public')
export class MediaController {
  constructor(@Inject(EDGES) private readonly edges: Edges) {}

  @Get(':file')
  async photo(@Param('file') file: string, @Res() res: Response): Promise<void> {
    if (!PHOTO_FILE.test(file)) throw new NotFoundException();
    const data = await this.edges.files.get(`${PUBLIC_PREFIX}${file}`);
    if (!data) throw new NotFoundException();
    res
      .status(200)
      .set({ 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' })
      .send(Buffer.from(data));
  }
}
