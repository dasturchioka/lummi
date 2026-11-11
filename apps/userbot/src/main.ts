/**
 * The Humo userbot (ADR 0014): its own process and container, no database access. It reads only the
 * listened chat, posts every message to the API's internal endpoint, forwards each ➕ to
 * «Поступления», catches up after a restart and beats every minute once caught up.
 */
import { startUserbot } from './bootstrap';
import { envSchema, parseEnv } from './env';
import { createFeedApi } from './feed-api';
import { createLogger } from './logger';
import { asBootClient, createTelegramClient } from './mtcute-client';
import { describeError } from './telegram';

const env = parseEnv(envSchema, process.env);
const log = createLogger(env.LOG_LEVEL);

// A bug or an unexpected failure ends the process; Compose restarts it and catch-up covers the gap.
const die = (e: unknown) => {
  log.error({ error: describeError(e) }, 'unexpected error; exiting (the container restarts)');
  process.exit(1);
};
process.on('unhandledRejection', die);
process.on('uncaughtException', die);

const started = await startUserbot({
  env,
  log,
  api: createFeedApi({ baseUrl: env.API_URL, secret: env.INTERNAL_API_SECRET }),
  createClient: () =>
    asBootClient(
      createTelegramClient({ apiId: env.USERBOT_API_ID, apiHash: env.USERBOT_API_HASH }),
    ),
  // Stay up doing nothing: a restart cannot fix it, and a restart loop would only hammer Telegram.
  onParked: () => void setInterval(() => undefined, 2 ** 31 - 1),
}).catch(die);

if (started.kind === 'running') {
  const stop = async (signal: string) => {
    log.info({ signal }, 'stopping');
    started.relay.stop();
    await started.client.destroy().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
}
