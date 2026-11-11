import {
  adminContract,
  contract,
  adminReviewsQuerySchema,
  REVIEWS_EXPORT_MIME,
} from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import {
  Controller,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Response } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { CurrentStaff, StaffGuard } from '../staff/staff.guard';
import { ReviewsService } from './reviews.service';

/** The reviews block on a fragrance or set card: published reviews only. */
@Controller()
export class ReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @TsRestHandler(contract.reviews.forTarget)
  @UseGuards(SessionGuard)
  forTarget() {
    return tsRestHandler(contract.reviews.forTarget, async ({ params }) => {
      const block = await this.reviews.block(params.target);
      return block
        ? { status: 200 as const, body: block }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  /**
   * A published review's photo by its unguessable key. No session: an `<img>` cannot send one, and
   * a published review is what every customer sees anyway. A hidden review's photo is a 404.
   */
  @Get('reviews/photos/:file')
  async photo(@Param('file') file: string, @Res() res: Response): Promise<void> {
    const match = /^([0-9a-f-]{36})\.jpg$/.exec(file);
    const bytes = match ? await this.reviews.publicPhoto(match[1]!) : null;
    if (!bytes) throw new NotFoundException();
    res
      .status(200)
      .set({ 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=300' })
      .send(Buffer.from(bytes));
  }
}

/** The reviews panel: owner and manager (staff publish and hide; spec Changes 2026-11-11). */
@Controller()
@UseGuards(StaffGuard)
export class ReviewsAdminController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @TsRestHandler(adminContract.reviews.list)
  list() {
    return tsRestHandler(adminContract.reviews.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.reviews.list(query),
    }));
  }

  @TsRestHandler(adminContract.reviews.setPublished)
  setPublished(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.reviews.setPublished, async ({ params, body }) => {
      const dto = await this.reviews.setPublished(actor.id, params.id, body.published);
      return dto
        ? { status: 200 as const, body: dto }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @Get('admin/reviews/export')
  async export(@Query() query: Record<string, string>, @Res() res: Response): Promise<void> {
    const parsed = adminReviewsQuerySchema.safeParse(query);
    if (!parsed.success) throw new HttpException({ code: 'invalid' }, 422);
    const bytes = await this.reviews.exportWorkbook(parsed.data);
    res
      .status(200)
      .type(REVIEWS_EXPORT_MIME)
      .setHeader('content-disposition', 'attachment; filename="LUMMI_Otzyvy.xlsx"')
      .setHeader('cache-control', 'no-store')
      .send(bytes);
  }

  @Get('admin/reviews/photos/:id')
  async photo(@Param('id', ParseIntPipe) id: number, @Res() res: Response): Promise<void> {
    const bytes = await this.reviews.staffPhoto(id);
    if (!bytes) throw new NotFoundException();
    res
      .status(200)
      .set({ 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300' })
      .send(Buffer.from(bytes));
  }
}
