import { createDb } from '@lummi/db';
import { createApp } from './app';
import {
  LocalFileStore,
  SystemClock,
  UnconfiguredReceiptJudge,
  UnconfiguredTelegramSender,
} from './edges';
import { parseEnv } from './env';

// A bad config throws here and the process refuses to boot.
const env = parseEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = await createApp({
  env,
  db,
  edges: {
    clock: new SystemClock(),
    telegram: new UnconfiguredTelegramSender(),
    receiptJudge: new UnconfiguredReceiptJudge(),
    files: new LocalFileStore(env.FILES_DIR),
  },
});
app.enableShutdownHooks();
await app.listen(env.API_PORT, env.API_HOST);
console.log(`API listening on http://${env.API_HOST}:${env.API_PORT}`);
process.on('SIGTERM', () => void pool.end());
