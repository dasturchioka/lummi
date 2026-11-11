import { createDb } from '@lummi/db';
import { createApp } from './app';
import {
  LocalFileStore,
  SystemClock,
  GrammySender,
  GrammyFiles,
  createReceiptJudge,
} from './edges';
import { BotService } from './bot/bot.service';
import { PinoLogger } from './logging/pino-logger';
import { parseEnv } from './env';
import { seedContent } from './content/seed';
import { CampaignsService } from './campaigns/campaigns.service';
import { WorkerWatch } from './ops/worker-watch.service';
import { syncSearchIndex } from './search/search-index';

const log = new PinoLogger('api');
// A bad config throws here and the process refuses to boot.
const env = parseEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = await createApp({
  env,
  db,
  edges: {
    clock: new SystemClock(),
    telegram: new GrammySender(env.BOT_TOKEN),
    telegramFiles: new GrammyFiles(env.BOT_TOKEN),
    receiptJudge: createReceiptJudge(env, db),
    files: new LocalFileStore(env.FILES_DIR),
  },
});
app.enableShutdownHooks();
// The search documents are rebuilt here, in the API process only (the worker boots the same module).
const rebuilt = await syncSearchIndex(db);
if (rebuilt > 0) log.log(`search index: rebuilt ${rebuilt} document(s)`, 'Main');
await seedContent(db);
// promo codes that predate campaign links get theirs (ticket #35); a second boot changes nothing
const linked = await app.get(CampaignsService).backfillPromoLinks();
if (linked > 0) log.log(`campaign links: made ${linked} for existing promo codes`, 'Main');
await app.get(BotService).start();
app.get(WorkerWatch).start();
await app.listen(env.API_PORT, env.API_HOST);
log.log(`API listening on http://${env.API_HOST}:${env.API_PORT}`, 'Main');
process.on('SIGTERM', () => void pool.end());
