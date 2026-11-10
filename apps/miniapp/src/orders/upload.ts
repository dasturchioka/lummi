import { RECEIPT_FILE_NAME_HEADER, type ReceiptUploadError } from '@lummi/contracts/constants';
import type { OrderDto, ReceiptUploadedDto } from '@lummi/contracts';
import { API_BASE, session } from '../lib/api';

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
const KINDS = /^(image\/(jpeg|png|webp)|application\/pdf)$/;
const EXTENSIONS = /\.(jpe?g|png|webp|pdf)$/i;
export function precheckReceipt(file: File, maxBytes: number): ReceiptUploadError | null {
  if (file.size === 0 || !(KINDS.test(file.type) || EXTENSIONS.test(file.name)))
    return 'unsupported_type';
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
 * session token attached and, like every other call, one fresh sign-in after a 401.
 */
export async function uploadReceipt(
  number: number,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<UploadResult> {
  const token = await session.getToken();
  let res = await send(token, number, file, onProgress);
  if (res.status === 401) {
    onProgress(0);
    res = await send(await session.recover(token), number, file, onProgress);
  }
  const body = res.body as { code?: string; order?: OrderDto } | null;
  if (res.status === 201) return { kind: 'uploaded', body: res.body as ReceiptUploadedDto };
  if (res.status === 413) return { kind: 'refused', code: 'too_large' };
  if (res.status === 415) return { kind: 'refused', code: 'unsupported_type' };
  if (res.status === 422) return { kind: 'refused', code: 'unreadable' };
  if (res.status === 404) return { kind: 'not_found' };
  if (res.status === 409)
    return body?.code === 'status_changed' && body.order
      ? { kind: 'changed', order: body.order }
      : { kind: 'try_again' };
  throw new UploadNetworkError(`HTTP ${res.status}`);
}
