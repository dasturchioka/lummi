import { adminContract, contract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, Param, ParseIntPipe, Put, Req, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { photoFailure, readPhotoBody } from '../catalog/photo-upload';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { ContentService, type ContentFailure } from './content.service';

/** Browsing needs no registration (a session is enough), so a drafted page is read like an approved one. */
@Controller()
@UseGuards(SessionGuard)
export class ContentController {
  constructor(@Inject(ContentService) private readonly content: ContentService) {}

  @TsRestHandler(contract.content.home)
  home() {
    return tsRestHandler(contract.content.home, async () => ({
      status: 200 as const,
      body: await this.content.home(),
    }));
  }

  @TsRestHandler(contract.content.pages)
  pages() {
    return tsRestHandler(contract.content.pages, async () => ({
      status: 200 as const,
      body: await this.content.pages(),
    }));
  }

  @TsRestHandler(contract.content.page)
  page() {
    return tsRestHandler(contract.content.page, async ({ params }) => {
      const page = await this.content.page(params.slug);
      return page
        ? { status: 200 as const, body: page }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }
}

function failure(f: ContentFailure) {
  return f.reason === 'not_found'
    ? { status: 404 as const, body: { code: 'not_found' as const } }
    : { status: 422 as const, body: { code: 'invalid' as const, fields: f.fields } };
}

/** Banners, the slogan and the info pages are the owner's (ADR 0017); a manager gets 403. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class ContentAdminController {
  constructor(@Inject(ContentService) private readonly content: ContentService) {}

  @TsRestHandler(adminContract.content.banners.list)
  listBanners() {
    return tsRestHandler(adminContract.content.banners.list, async () => ({
      status: 200 as const,
      body: await this.content.listBanners(),
    }));
  }

  @TsRestHandler(adminContract.content.banners.create)
  createBanner(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.content.banners.create, async ({ body }) => {
      const res = await this.content.createBanner(actor, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.content.banners.update)
  updateBanner(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.content.banners.update, async ({ params, body }) => {
      const res = await this.content.updateBanner(actor, params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.content.banners.setActive)
  setActive(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.content.banners.setActive, async ({ params, body }) => {
      const res = await this.content.setBannerActive(actor, params.id, body.active);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.content.banners.remove)
  removeBanner(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.content.banners.remove, async ({ params }) => {
      const res = await this.content.deleteBanner(actor, params.id);
      return res.ok
        ? { status: 200 as const, body: { ok: true as const } }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  /** Raw image bytes, judged by magic bytes and capped like the catalog photos (ADR 0020). */
  @Put('admin/content/banners/:id/photo')
  async photo(
    @Param('id', ParseIntPipe) id: number,
    @CurrentStaff() actor: StaffRow,
    @Req() req: Request,
  ) {
    const bytes = readPhotoBody(req.body);
    const res = await this.content.setBannerPhoto(actor, id, bytes);
    if (res.ok) return res.value;
    throw photoFailure(res.reason);
  }

  @TsRestHandler(adminContract.content.slogan.get)
  getSlogan() {
    return tsRestHandler(adminContract.content.slogan.get, async () => ({
      status: 200 as const,
      body: { slogan: await this.content.slogan() },
    }));
  }

  @TsRestHandler(adminContract.content.slogan.set)
  setSlogan(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.content.slogan.set, async ({ body }) => {
      const res = await this.content.setSlogan(actor, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.content.pages.list)
  listPages() {
    return tsRestHandler(adminContract.content.pages.list, async () => ({
      status: 200 as const,
      body: await this.content.listAdminPages(),
    }));
  }

  @TsRestHandler(adminContract.content.pages.update)
  updatePage(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.content.pages.update, async ({ params, body }) => {
      const res = await this.content.updatePage(actor, params.slug, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }
}
