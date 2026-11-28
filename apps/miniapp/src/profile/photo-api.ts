import { customerSchema, MAX_PHOTO_BYTES, type CustomerDto } from '@lummi/contracts';
import { API_BASE, withSession } from '../lib/api';

export type PhotoOutcome =
  | { ok: true; customer: CustomerDto }
  | { ok: false; reason: 'too_large' | 'bad_type' | 'no_telegram' | 'too_many' | 'failed' };

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

async function outcome(res: Response): Promise<PhotoOutcome> {
  if (res.ok) return { ok: true, customer: customerSchema.parse(await res.json()) };
  if (res.status === 413) return { ok: false, reason: 'too_large' };
  if (res.status === 429) return { ok: false, reason: 'too_many' };
  if (res.status === 415 || res.status === 422) return { ok: false, reason: 'bad_type' };
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === 'no_telegram_photo') return { ok: false, reason: 'no_telegram' };
  }
  return { ok: false, reason: 'failed' };
}

const call = (path: string, init: RequestInit) =>
  withSession((token) =>
    fetch(`${API_BASE}/me/photo${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    }),
  ).then(outcome, () => ({ ok: false, reason: 'failed' }) as const);

/** The raw image bytes; the server checks the type by its first bytes and crops the square. */
export async function uploadPhoto(file: File): Promise<PhotoOutcome> {
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, reason: 'too_large' };
  if (!ACCEPTED.includes(file.type)) return { ok: false, reason: 'bad_type' };
  return call('', { method: 'PUT', headers: { 'content-type': file.type }, body: file });
}

/** The server fetches the Telegram photo itself; nothing but the request is sent. */
export const photoFromTelegram = () => call('/telegram', { method: 'POST' });

export const removePhoto = () => call('', { method: 'DELETE' });
