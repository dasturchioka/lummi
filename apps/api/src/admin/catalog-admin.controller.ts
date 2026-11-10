import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, Param, ParseIntPipe, Put, Req, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Request } from 'express';
import { photoFailure, readPhotoBody } from '../catalog/photo-upload';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { CatalogAdminService, type Failure } from './catalog-admin.service';

/** One mapping for service failures; the field paths ride along so the form can mark them. */
function failure(f: Failure) {
  const fields = f.fields;
  switch (f.reason) {
    case 'not_found':
      return { status: 404 as const, body: { code: 'not_found' as const } };
    case 'conflict':
      return { status: 409 as const, body: { code: 'conflict' as const, fields } };
    case 'on_hand_changed':
      return {
        status: 409 as const,
        body: { code: 'on_hand_changed' as const, fields, current: f.current },
      };
    case 'invalid':
      return { status: 422 as const, body: { code: 'invalid' as const, fields } };
    case 'try_again':
      return { status: 409 as const, body: { code: 'try_again' as const } };
  }
}

/** The catalog is the owner's (ADR 0017). On hand is the one thing a manager may also change. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class CatalogAdminController {
  constructor(@Inject(CatalogAdminService) private readonly catalog: CatalogAdminService) {}

  @TsRestHandler(adminContract.catalog.fragrances.list)
  list() {
    return tsRestHandler(adminContract.catalog.fragrances.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.catalog.list(query),
    }));
  }

  @TsRestHandler(adminContract.catalog.fragrances.get)
  get() {
    return tsRestHandler(adminContract.catalog.fragrances.get, async ({ params }) => {
      const f = await this.catalog.get(params.id);
      return f
        ? { status: 200 as const, body: f }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @TsRestHandler(adminContract.catalog.fragrances.create)
  create(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.catalog.fragrances.create, async ({ body }) => {
      const res = await this.catalog.create(actor, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.catalog.fragrances.update)
  update(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.catalog.fragrances.update, async ({ params, body }) => {
      const res = await this.catalog.update(actor, params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.catalog.fragrances.setHidden)
  setHidden(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.catalog.fragrances.setHidden, async ({ params, body }) => {
      const res = await this.catalog.setHidden(actor, params.id, body.hidden);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.catalog.families.list)
  listFamilies() {
    return tsRestHandler(adminContract.catalog.families.list, async () => ({
      status: 200 as const,
      body: await this.catalog.listDictionary('families'),
    }));
  }

  @TsRestHandler(adminContract.catalog.families.create)
  createFamily(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.catalog.families.create, async ({ body }) => {
      const res = await this.catalog.saveDictionary(actor, 'families', null, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.catalog.families.update)
  updateFamily(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.catalog.families.update, async ({ params, body }) => {
      const res = await this.catalog.saveDictionary(actor, 'families', params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.catalog.notes.list)
  listNotes() {
    return tsRestHandler(adminContract.catalog.notes.list, async () => ({
      status: 200 as const,
      body: await this.catalog.listDictionary('notes'),
    }));
  }

  @TsRestHandler(adminContract.catalog.notes.create)
  createNote(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.catalog.notes.create, async ({ body }) => {
      const res = await this.catalog.saveDictionary(actor, 'notes', null, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.catalog.notes.update)
  updateNote(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.catalog.notes.update, async ({ params, body }) => {
      const res = await this.catalog.saveDictionary(actor, 'notes', params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  /** Raw image bytes, see `readPhotoBody`. */
  @Put('admin/volumes/:id/photo')
  async photo(
    @Param('id', ParseIntPipe) id: number,
    @CurrentStaff() actor: StaffRow,
    @Req() req: Request,
  ) {
    const res = await this.catalog.setPhoto(actor, id, readPhotoBody(req.body));
    if (res.ok) return { photo: res.value };
    throw photoFailure(res.reason);
  }
}

/** On hand: any active staff member (owner and manager), audited with the actor. */
@Controller()
@UseGuards(StaffGuard)
export class OnHandController {
  constructor(@Inject(CatalogAdminService) private readonly catalog: CatalogAdminService) {}

  @TsRestHandler(adminContract.onHand.set)
  set(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.onHand.set, async ({ params, body }) => {
      const res = await this.catalog.setOnHand(actor, params.id, body.onHand, body.expected);
      if (res.ok) return { status: 200 as const, body: res.value };
      if (res.reason === 'on_hand_changed') return failure(res);
      return res.reason === 'try_again'
        ? { status: 409 as const, body: { code: 'try_again' as const } }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }
}
