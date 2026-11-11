import { MemoryStorage, TelegramClient } from '@mtcute/node';
import type { BootClient } from './bootstrap';
import type { LoginClient } from './login';
import type { MtcuteClient } from './telegram';

/** mtcute's log levels (LogManager): warnings and errors only, so no account details at info. */
const MTCUTE_LOG_WARN = 2;

/**
 * The one way the userbot builds an mtcute client (ADR 0014). Storage is in memory: the session
 * string, sealed in its file, is the only copy at rest, so mtcute never writes an auth key to disk.
 * The device name is what the account owner sees under Settings > Devices, to find and end it.
 */
export function createTelegramClient(o: { apiId: number; apiHash: string }): TelegramClient {
  return new TelegramClient({
    apiId: o.apiId,
    apiHash: o.apiHash,
    storage: new MemoryStorage(),
    logLevel: MTCUTE_LOG_WARN,
    initConnectionOptions: {
      deviceModel: 'LUMMI userbot',
      systemVersion: 'server',
      appVersion: '1.0',
    },
  });
}

/** Compile-time checks that the real client is what the relay, the start and the login expect. */
export const asMtcuteClient = (client: TelegramClient): MtcuteClient => client;
export const asBootClient = (client: TelegramClient): BootClient => client;
export const asLoginClient = (client: TelegramClient): LoginClient => client;
