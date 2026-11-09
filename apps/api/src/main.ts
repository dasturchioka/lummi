import { createDb } from '@lummi/db';
import { createApp } from './app';
import { LocalFileStore, SystemClock, GrammySender, createReceiptJudge } from './edges';
import { BotService } from './bot/bot.service';
import { parseEnv } from './env';

// A bad config throws here and the process refuses to boot.
const env = parseEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = await createApp({
  env,
  db,
  edges: {
    clock: new SystemClock(),
    telegram: new GrammySender(env.BOT_TOKEN),
    receiptJudge: createReceiptJudge(env, db),
    files: new LocalFileStore(env.FILES_DIR),
  },
});
app.enableShutdownHooks();
await app.get(BotService).start();
await app.listen(env.API_PORT, env.API_HOST);
console.log(`API listening on http://${env.API_HOST}:${env.API_PORT}`);
process.on('SIGTERM', () => void pool.end());
