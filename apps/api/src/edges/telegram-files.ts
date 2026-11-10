import { Api, GrammyError } from 'grammy';

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
}

export class UnconfiguredTelegramFiles implements TelegramFiles {
  download(): Promise<FileDownload> {
    return Promise.reject(new Error('TelegramFiles is not configured yet'));
  }
}

/** The real download: grammY `getFile`, then a streamed GET that stops at `maxBytes`. */
export class GrammyFiles implements TelegramFiles {
  private readonly api: Api;
  constructor(private readonly token: string) {
    this.api = new Api(token);
  }

  async download(fileId: string, maxBytes: number): Promise<FileDownload> {
    try {
      const file = await this.api.getFile(fileId);
      if (file.file_size !== undefined && file.file_size > maxBytes) return { kind: 'too_large' };
      if (!file.file_path) return { kind: 'unavailable' };
      const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok || !res.body) return { kind: 'unavailable' };
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > maxBytes) {
          await res.body.cancel().catch(() => undefined);
          return { kind: 'too_large' };
        }
        chunks.push(chunk);
      }
      return { kind: 'ok', bytes: Buffer.concat(chunks) };
    } catch (e) {
      // The message of a fetch or grammY error can carry the URL (and so the token): drop it.
      if (e instanceof GrammyError && /too big/i.test(e.description)) return { kind: 'too_large' };
      return { kind: 'unavailable' };
    }
  }
}
