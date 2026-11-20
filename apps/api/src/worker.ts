import { createDb } from '@lummi/db';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from './app.module';
import {
  GrammySender,
  GrammyFiles,
  LocalFileStore,
  SystemClock,
  createReceiptJudge,
} from './edges';
import { PinoLogger } from './logging/pino-logger';
import { parseEnv } from './env';
import { ErrorTracker } from './ops/error-tracker.service';
import { WorkerRuntime } from './worker/runtime';
import { describeError } from './logging/describe-error';

// Separate from HTTP (ADR 0015): a crashed worker never takes down checkout.
// Same modules as the API, as an application context without an HTTP listener.
const log = new PinoLogger('worker');
const env = parseEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = await NestFactory.createApplicationContext(
  AppModule.register({
    env,
    db,
    edges: {
      clock: new SystemClock(),
      telegram: new GrammySender(env.BOT_TOKEN),
      telegramFiles: new GrammyFiles(env.BOT_TOKEN),
      receiptJudge: createReceiptJudge(env, db),
      files: new LocalFileStore(env.FILES_DIR),
    },
  }),
  { logger: log },
);
app.enableShutdownHooks();
const worker = app.get(WorkerRuntime);
worker.start();
const errors = app.get(ErrorTracker);
const run = () =>
  worker.tick().catch((e: unknown) => {
    log.error(`tick failed: ${describeError(e)}`, 'Worker');
    void errors.record(e, 'worker:tick');
  });
await run();
const timer = setInterval(run, 60_000);
log.log('worker started', 'Worker');
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void app.close().then(() => pool.end());
  });
}
