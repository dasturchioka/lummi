import {
  RECEIPT_FILE_NAME_HEADER,
  RECEIPT_FILE_TYPES,
  receiptUploadCode,
  type ReceiptUploadError,
} from '@lummi/contracts/constants';
import type { OrderDto, ReceiptUploadedDto } from '@lummi/contracts';
import { API_BASE, withSession } from '../lib/api';

export type UploadResult =
  | { kind: 'uploaded'; body: ReceiptUploadedDto }
  /** The file is not a receipt the server takes (type, size, cannot be opened). */
  | { kind: 'refused'; code: ReceiptUploadError }
  /** The order is no longer «Ожидает оплаты» (a receipt already went in, it was cancelled). */
  | { kind: 'changed'; order: OrderDto }
  | { kind: 'try_again' }
  | { kind: 'not_found' };

/** No answer at all (offline, dropped): the screen offers to send again. */
export class UploadNetworkError extends Error {}

/** What the app can tell before sending: the kind by type or extension, and the size. */
const TYPES = Object.values(RECEIPT_FILE_TYPES);
export function precheckReceipt(file: File, maxBytes: number): ReceiptUploadError | null {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
  const known = TYPES.some((t) => t.mime === file.type || t.extensions.includes(extension));
  if (file.size === 0 || !known) return 'unsupported_type';
  if (file.size > maxBytes) return 'too_large';
  return null;
}

function send(
  token: string,
  number: number,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/orders/${number}/receipts`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    // the server tells the kind by the first bytes; the header type is only how the body is read
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader(RECEIPT_FILE_NAME_HEADER, encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* not JSON: a proxy's page */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new UploadNetworkError('the upload did not reach the server'));
    xhr.onabort = () => reject(new UploadNetworkError('the upload was stopped'));
    xhr.send(file);
  });
}

/**
 * `POST /orders/:number/receipts` with upload progress (XMLHttpRequest: `fetch` reports none), the
 * session token attached and, like every other call, one fresh sign-in after a 401. The answer's
 * code comes from its status (`RECEIPT_UPLOAD_STATUS`).
 */
export async function uploadReceipt(
  number: number,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<UploadResult> {
  const res = await withSession((token) => send(token, number, file, onProgress));
  if (res.status === 201) return { kind: 'uploaded', body: res.body as ReceiptUploadedDto };
  const body = res.body as { order?: OrderDto } | null;
  const code = receiptUploadCode(res.status);
  switch (code) {
    case 'too_large':
    case 'unsupported_type':
    case 'unreadable':
      return { kind: 'refused', code };
    case 'not_found':
      return { kind: 'not_found' };
    case 'status_changed':
      return body?.order ? { kind: 'changed', order: body.order } : { kind: 'try_again' };
    case 'try_again':
      return { kind: 'try_again' };
    default:
      throw new UploadNetworkError(`HTTP ${res.status}`);
  }
}
