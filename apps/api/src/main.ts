import { createDb } from '@lummi/db';
import { createApp } from './app';
import { LocalFileStore, SystemClock, GrammySender, createReceiptJudge } from './edges';
import { BotService } from './bot/bot.service';
import { parseEnv } from './env';
import { seedContent } from './content/seed';
import { syncSearchIndex } from './search/search-index';

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
// The search documents are rebuilt here, in the API process only (the worker boots the same module).
const rebuilt = await syncSearchIndex(db);
if (rebuilt > 0) console.log(`search index: rebuilt ${rebuilt} document(s)`);
await seedContent(db);
await app.get(BotService).start();
await app.listen(env.API_PORT, env.API_HOST);
console.log(`API listening on http://${env.API_HOST}:${env.API_PORT}`);
process.on('SIGTERM', () => void pool.end());
