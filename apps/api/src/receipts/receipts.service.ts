import {
  RECEIPT_FILE_NAME_MAX,
  RECEIPT_FILE_TYPES,
  type OrderDto,
  type PaymentDto,
  type ReceiptFileKind,
  type ReceiptSummaryDto,
  type ReceiptUploadError,
} from '@lummi/contracts';
import {
  and,
  desc,
  eq,
  orders,
  receipts,
  type Db,
  type DbOrTx,
  type OrderRow,
  type ReceiptRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Edges } from '../edges';
import { cancellationOf } from '../order-status/history';
import { OrderStatusService } from '../order-status/order-status.service';
import { linesOf, toOrderDto } from '../orders/orders.service';
import { OutboxService } from '../outbox/outbox.service';
import { readShopCard } from '../payment/shop-card.service';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { retryTransientOnce, TryAgainError } from '../util/transient';
import {
  differenceHash,
  normalizeReceipt,
  ReceiptBusyError,
  receiptKind,
  sha256Hex,
  UnreadableReceiptError,
  type NormalizedReceipt,
} from './receipt-file';

/** Where the files live in the FileStore: `/media/private` on the VPS, never served as static (ADR 0020). */
const PRIVATE_PREFIX = 'private/receipts/';
/** The extension an original is stored under: its kind's first (`jpeg` → `.jpg`). */
const extensionOf = (kind: ReceiptFileKind) => RECEIPT_FILE_TYPES[kind].extensions[0]!;
/** The extension of the image the AI is shown, by its type (JPEG or PNG, ADR 0033). */
const judgeExtension = (mime: string) => (mime === 'image/jpeg' ? 'jpg' : 'png');

export type SubmitOutcome =
  | { kind: 'submitted'; receipt: ReceiptSummaryDto; order: OrderDto }
  /** No such order among the shopper's own. */
  | { kind: 'not_found' }
  /** The order is not «Ожидает оплаты» (a receipt already under check, paid, cancelled): nothing stored. */
  | { kind: 'status_changed'; order: OrderDto }
  | { kind: 'refused'; code: ReceiptUploadError; maxBytes?: number }
  | { kind: 'try_again' };

export interface ReceiptFile {
  data: Uint8Array;
  contentType: string;
  /** A name for the download, never the shopper's own (it goes into a header). */
  downloadName: string;
  /** PDFs are offered as a download, images shown inline. */
  inline: boolean;
}

export const toReceiptSummary = (r: ReceiptRow): ReceiptSummaryDto => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  fileName: r.fileName,
  size: r.size,
  kind: r.kind === 'pdf' ? 'pdf' : 'image',
});

/**
 * The name the device gave the file, as the shopper will see it again: decoded, without a path,
 * control characters or surrounding space, at most `RECEIPT_FILE_NAME_MAX` characters.
 */
export function cleanFileName(raw: string | undefined): string | null {
  if (!raw) return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const base = name.split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean ? clean.slice(0, RECEIPT_FILE_NAME_MAX) : null;
}

/**
 * Receipt intake and the payment screen (ADR 0011, 0013, 0020). An upload is typed by its first
 * bytes, capped by the setting `receipts.maxUploadMb`, kept as the original under a random name in
 * private storage next to the image normalised for the AI, hashed (SHA-256 and a perceptual
 * hash), and recorded as a Receipt with verdict `pending`; in the same transaction the order moves
 * «Ожидает оплаты» → «Чек на проверке» through `transition()`, which queues the "receipt received"
 * message. The bot's receipts (#31) come through `submit` too.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
  ) {}

  /** The payment screen of one of the shopper's orders; null when it is not theirs. */
  async payment(customerId: number, number: number): Promise<PaymentDto | null> {
    const order = await this.ownOrder(this.db, customerId, number);
    if (!order) return null;
    const [card, sent, maxUploadBytes] = await Promise.all([
      readShopCard(this.db),
      this.db
        .select()
        .from(receipts)
        .where(eq(receipts.orderId, order.id))
        .orderBy(desc(receipts.id)),
      this.maxUploadBytes(),
    ]);
    return {
      order: await this.dto(this.db, order),
      card: card ? { number: card.number, holder: card.holder } : null,
      receipts: sent.map(toReceiptSummary),
      maxUploadBytes,
    };
  }

  /** The largest upload in bytes: the setting `receipts.maxUploadMb`. */
  async maxUploadBytes(): Promise<number> {
    const settings = await readSettings(this.db, ['receipts.maxUploadMb']);
    return settings['receipts.maxUploadMb'] * 1024 * 1024;
  }

  async submit(
    customerId: number,
    number: number,
    bytes: Uint8Array,
    from: { fileName: string | null; source: 'miniapp' | 'bot' },
  ): Promise<SubmitOutcome> {
    // cheap refusals first: whose order, its status, the size and the kind
    const order = await this.ownOrder(this.db, customerId, number);
    if (!order) return { kind: 'not_found' };
    if (order.status !== 'awaiting_payment')
      return { kind: 'status_changed', order: await this.dto(this.db, order) };
    const maxBytes = await this.maxUploadBytes();
    if (bytes.length > maxBytes) return { kind: 'refused', code: 'too_large', maxBytes };
    const kind = receiptKind(bytes);
    if (!kind) return { kind: 'refused', code: 'unsupported_type' };

    let normalized: NormalizedReceipt;
    try {
      normalized = await normalizeReceipt(bytes, kind);
    } catch (e) {
      if (e instanceof UnreadableReceiptError) return { kind: 'refused', code: 'unreadable' };
      // every PDF render slot is taken: nothing is stored, the same file may go again
      if (e instanceof ReceiptBusyError) return { kind: 'try_again' };
      throw e;
    }
    const name = randomUUID();
    const originalKey = `${PRIVATE_PREFIX}${name}.${extensionOf(kind)}`;
    const normalizedKey = `${PRIVATE_PREFIX}${name}.judge.${judgeExtension(normalized.mime)}`;
    const [sha256, phash] = [sha256Hex(bytes), await differenceHash(normalized.data)];
    await this.edges.files.put(originalKey, bytes);
    await this.edges.files.put(normalizedKey, normalized.data);
    const deleteStoredFiles = async () => {
      await this.edges.files.delete(originalKey);
      await this.edges.files.delete(normalizedKey);
    };

    try {
      const out = await retryTransientOnce(() =>
        this.outbox.withTx(async (tx): Promise<SubmitOutcome> => {
          const [locked] = await tx
            .select()
            .from(orders)
            .where(eq(orders.id, order.id))
            .for('update');
          if (!locked || locked.status !== 'awaiting_payment')
            return { kind: 'status_changed', order: await this.dto(tx, locked ?? order) };
          const [receipt] = await tx
            .insert(receipts)
            .values({
              orderId: order.id,
              source: from.source,
              fileName: from.fileName,
              kind,
              size: bytes.length,
              originalKey,
              normalizedKey,
              normalizedMime: normalized.mime,
              width: normalized.width,
              height: normalized.height,
              sha256,
              phash,
              createdAt: this.edges.clock.now(),
            })
            .returning();
          if (!receipt) throw new Error('receipt insert returned nothing');
          const moved = await this.status.transitionIn(
            tx,
            order.id,
            'submit_receipt',
            { type: 'customer', id: customerId },
            'awaiting_payment',
            { receiptId: receipt.id },
          );
          // the row is locked and «Ожидает оплаты»: any refusal here is a bug, and rolls back
          if (moved.kind !== 'done')
            throw new Error(`order ${order.number}: submit_receipt answered ${moved.kind}`);
          return {
            kind: 'submitted',
            receipt: toReceiptSummary(receipt),
            order: await this.dto(tx, moved.order),
          };
        }),
      );
      if (out.kind !== 'submitted') await deleteStoredFiles();
      return out;
    } catch (e) {
      await deleteStoredFiles();
      if (e instanceof TryAgainError) return { kind: 'try_again' };
      throw e;
    }
  }

  /** The original, for the shopper who sent it: only through their own order (ADR 0020). */
  async fileForCustomer(
    customerId: number,
    number: number,
    receiptId: number,
  ): Promise<ReceiptFile | null> {
    const order = await this.ownOrder(this.db, customerId, number);
    if (!order) return null;
    const [row] = await this.db
      .select()
      .from(receipts)
      .where(and(eq(receipts.id, receiptId), eq(receipts.orderId, order.id)));
    return row ? this.read(row, 'original') : null;
  }

  /** Staff (owner and manager) see any receipt: the original, or the image the AI was shown. */
  async fileForStaff(
    receiptId: number,
    variant: 'original' | 'normalized',
  ): Promise<ReceiptFile | null> {
    const [row] = await this.db.select().from(receipts).where(eq(receipts.id, receiptId));
    return row ? this.read(row, variant) : null;
  }

  private async read(
    row: ReceiptRow,
    variant: 'original' | 'normalized',
  ): Promise<ReceiptFile | null> {
    const original = variant === 'original';
    const data = await this.edges.files.get(original ? row.originalKey : row.normalizedKey);
    if (!data) return null;
    const contentType = original ? RECEIPT_FILE_TYPES[row.kind].mime : row.normalizedMime;
    const ext = original ? extensionOf(row.kind) : judgeExtension(row.normalizedMime);
    return {
      data,
      contentType,
      downloadName: `receipt-${row.id}${original ? '' : '-judge'}.${ext}`,
      inline: contentType !== 'application/pdf',
    };
  }

  private async ownOrder(db: DbOrTx, customerId: number, number: number) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.number, number)));
    return order ?? null;
  }

  private async dto(db: DbOrTx, order: OrderRow): Promise<OrderDto> {
    return toOrderDto(order, await linesOf(db, order.id), await cancellationOf(db, order.id));
  }
}
