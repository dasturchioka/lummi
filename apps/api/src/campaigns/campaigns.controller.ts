import { adminContract, campaignQrQuerySchema, contract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import {
  BadRequestException,
  Controller,
  Get,
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
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { CampaignsService, type CampaignFailure } from './campaigns.service';

const notFound = { status: 404 as const, body: { code: 'not_found' as const } };
function failure(f: CampaignFailure) {
  if (f.reason === 'not_found') return notFound;
  if (f.reason === 'unknown_promo_code')
    return { status: 422 as const, body: { code: f.reason, fields: ['promoCode'] } };
  return { status: 409 as const, body: { code: f.reason } };
}

/** The Mini App's side: one signed-in call when `l_<code>` launched it. */
@Controller()
@UseGuards(SessionGuard)
export class CampaignsController {
  constructor(@Inject(CampaignsService) private readonly campaigns: CampaignsService) {}

  @TsRestHandler(contract.campaigns.open)
  open(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.campaigns.open, async ({ body }) => {
      const res = await this.campaigns.open(customerId, body.code);
      return res ? { status: 200 as const, body: res } : notFound;
    });
  }
}

/** Campaign links are the owner's (ADR 0017), like promo codes; a manager gets 403. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class CampaignsAdminController {
  constructor(@Inject(CampaignsService) private readonly campaigns: CampaignsService) {}

  @TsRestHandler(adminContract.campaignLinks.list)
  list() {
    return tsRestHandler(adminContract.campaignLinks.list, async () => ({
      status: 200 as const,
      body: await this.campaigns.list(),
    }));
  }

  @TsRestHandler(adminContract.campaignLinks.get)
  get() {
    return tsRestHandler(adminContract.campaignLinks.get, async ({ params }) => {
      const found = await this.campaigns.get(params.id);
      return found ? { status: 200 as const, body: found } : notFound;
    });
  }

  @TsRestHandler(adminContract.campaignLinks.create)
  create(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.campaignLinks.create, async ({ body }) => {
      const res = await this.campaigns.create(actor, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.campaignLinks.update)
  update(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.campaignLinks.update, async ({ params, body }) => {
      const res = await this.campaigns.update(actor, params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.campaignLinks.remove)
  remove(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.campaignLinks.remove, async ({ params }) => {
      const res = await this.campaigns.remove(actor, params.id);
      return res.ok ? { status: 200 as const, body: { ok: true as const } } : failure(res);
    });
  }

  /** The QR as a download; a file, so it is outside the ts-rest contract. */
  @Get('admin/campaign-links/:id/qr')
  async qr(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const parsed = campaignQrQuerySchema.safeParse({ format: query.format });
    if (!parsed.success) throw new BadRequestException({ code: 'invalid', fields: ['format'] });
    const { format } = parsed.data;
    const qr = await this.campaigns.qr(id, format);
    if (!qr) throw new NotFoundException({ code: 'not_found' });
    res
      .status(200)
      .type(format === 'svg' ? 'image/svg+xml; charset=utf-8' : 'image/png')
      .setHeader('content-disposition', `attachment; filename="lummi-${qr.code}.${format}"`)
      .setHeader('cache-control', 'no-store')
      .send(qr.body);
  }
}
