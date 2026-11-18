import { Logger } from '@nestjs/common';
import { Api, GrammyError } from 'grammy';
import { describeError } from '../logging/describe-error';
import { withTimeout } from '../util/with-timeout';

/** Technical guards, not rules: how long `getFile` and the download may take before the attempt fails and is retried. */
const GET_FILE_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** What a download of a user's file from Telegram came to. */
export type FileDownload =
  | { kind: 'ok'; bytes: Uint8Array }
  /** Over the cap: by the size Telegram reports, by the 20 MB Bot API ceiling, or while streaming. */
  | { kind: 'too_large' }
  /** Telegram cannot give the file (expired id, network): the shopper may send it again. */
  | { kind: 'unavailable' };

/**
 * The files users send to the bot (receipts, #31): `getFile`, then the download from Telegram's file
 * host. An edge because it is the network; tests use a fake that serves bytes by `file_id`.
 * Implementations never log or throw the token or the file URL.
 */
export interface TelegramFiles {
  download(fileId: string, maxBytes: number): Promise<FileDownload>;
  /**
   * A profile photo by the `photo_url` of a signed initData (#67). Only Telegram's own https hosts
   * are fetched, without following redirects; anything else is `unavailable`.
   */
  downloadUrl(url: string, maxBytes: number): Promise<FileDownload>;
}

/** Hosts a signed `photo_url` may point at (`t.me/i/userpic/...`, Telegram's CDNs). */
export function isTelegramPhotoUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return ['t.me', 'telegram.org', 'telesco.pe', 'telegram-cdn.org'].some(
    (h) => host === h || host.endsWith(`.${h}`),
  );
}

async function readCapped(res: Response, maxBytes: number): Promise<FileDownload> {
  if (!res.ok || !res.body) return { kind: 'unavailable' };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) return { kind: 'too_large' };
    chunks.push(chunk);
  }
  return { kind: 'ok', bytes: Buffer.concat(chunks) };
}

export class UnconfiguredTelegramFiles implements TelegramFiles {
  download(): Promise<FileDownload> {
    return Promise.reject(new Error('TelegramFiles is not configured yet'));
  }
  downloadUrl(): Promise<FileDownload> {
    return Promise.reject(new Error('TelegramFiles is not configured yet'));
  }
}

/** The real download: grammY `getFile`, then a streamed GET that stops at `maxBytes`. */
export class GrammyFiles implements TelegramFiles {
  private readonly api: Api;
  private readonly log = new Logger('TelegramFiles');
  constructor(private readonly token: string) {
    this.api = new Api(token);
  }

  async downloadUrl(url: string, maxBytes: number): Promise<FileDownload> {
    if (!isTelegramPhotoUrl(url)) return { kind: 'unavailable' };
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        redirect: 'error',
      });
      return await readCapped(res, maxBytes);
    } catch (e) {
      this.log.warn(`photo_url download failed: ${describeError(e)}`);
      return { kind: 'unavailable' };
    }
  }

  async download(fileId: string, maxBytes: number): Promise<FileDownload> {
    try {
      const file = await withTimeout(this.api.getFile(fileId), GET_FILE_TIMEOUT_MS);
      if (file.file_size !== undefined && file.file_size > maxBytes) return { kind: 'too_large' };
      if (!file.file_path) return { kind: 'unavailable' };
      const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!res.ok || !res.body) return { kind: 'unavailable' };
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > maxBytes) {
          return { kind: 'too_large' };
        }
        chunks.push(chunk);
      }
      return { kind: 'ok', bytes: Buffer.concat(chunks) };
    } catch (e) {
      if (e instanceof GrammyError && /too big/i.test(e.description)) return { kind: 'too_large' };
      // describeError keeps the error's name and code, never the request URL (which holds the token)
      this.log.warn(`download failed: ${describeError(e)}`);
      return { kind: 'unavailable' };
    }
  }
}
