import { contract, RECEIPT_FILE_NAME_HEADER } from '@lummi/contracts';
import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Request, Response } from 'express';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { StaffGuard } from '../staff/staff.guard';
import { cleanFileName, ReceiptsService, type ReceiptFile } from './receipts.service';

/**
 * A receipt file is personal data (the payer's name, a card mask): never cached, never sniffed into
 * another type, never able to run anything if a browser opens it; a PDF is a download.
 */
function send(res: Response, file: ReceiptFile): void {
  res
    .status(200)
    .set({
      'content-type': file.contentType,
      'content-length': String(file.data.length),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': `${file.inline ? 'inline' : 'attachment'}; filename="${file.downloadName}"`,
    })
    .send(Buffer.from(file.data));
}

/**
 * The payment screen and receipt uploads, for the shopper's own orders (the session's, ADR 0029).
 * The upload is raw bytes (`application/octet-stream`) with the file name in `x-file-name`, outside
 * the ts-rest contract since it has no raw bodies; its answers are the contract's
 * `receiptUploadedSchema` and `receiptUploadErrorSchema`.
 */
@Controller()
@UseGuards(SessionGuard)
export class ReceiptsController {
  constructor(@Inject(ReceiptsService) private readonly receipts: ReceiptsService) {}

  @TsRestHandler(contract.orders.payment)
  payment(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.orders.payment, async ({ params }) => {
      const dto = await this.receipts.payment(customerId, params.number);
      return dto
        ? { status: 200 as const, body: dto }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @Post('orders/:number/receipts')
  @HttpCode(201)
  async upload(
    @Param('number', ParseIntPipe) number: number,
    @SessionCustomerId() customerId: number,
    @Req() req: Request,
  ) {
    const body: unknown = req.body;
    const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    const header = req.headers[RECEIPT_FILE_NAME_HEADER];
    const out = await this.receipts.submit(customerId, number, bytes, {
      fileName: cleanFileName(Array.isArray(header) ? header[0] : header),
      source: 'miniapp',
    });
    switch (out.kind) {
      case 'submitted':
        return { receipt: out.receipt, order: out.order };
      case 'not_found':
        throw new NotFoundException({ code: 'not_found' });
      case 'status_changed':
        throw new HttpException({ code: 'status_changed', order: out.order }, 409);
      case 'try_again':
        throw new HttpException({ code: 'try_again' }, 409);
      case 'refused': {
        const status = { too_large: 413, unsupported_type: 415, unreadable: 422 }[out.code];
        throw new HttpException(
          { code: out.code, ...(out.maxBytes ? { maxBytes: out.maxBytes } : {}) },
          status,
        );
      }
    }
  }

  @Get('orders/:number/receipts/:id/file')
  async file(
    @Param('number', ParseIntPipe) number: number,
    @Param('id', ParseIntPipe) id: number,
    @SessionCustomerId() customerId: number,
    @Res() res: Response,
  ) {
    const file = await this.receipts.fileForCustomer(customerId, number, id);
    if (!file) throw new NotFoundException({ code: 'not_found' });
    send(res, file);
  }
}

/** Any staff member (owner or manager) opens any receipt: the original or the AI's image (#33). */
@Controller()
@UseGuards(StaffGuard)
export class ReceiptsAdminController {
  constructor(@Inject(ReceiptsService) private readonly receipts: ReceiptsService) {}

  @Get('admin/receipts/:id/file')
  async file(
    @Param('id', ParseIntPipe) id: number,
    @Query('variant') variant: string | undefined,
    @Res() res: Response,
  ) {
    if (variant !== undefined && variant !== 'original' && variant !== 'normalized')
      throw new NotFoundException({ code: 'not_found' });
    const file = await this.receipts.fileForStaff(id, variant ?? 'original');
    if (!file) throw new NotFoundException({ code: 'not_found' });
    send(res, file);
  }
}
