import { createDb } from '@lummi/db';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { GrammySender, LocalFileStore, SystemClock, UnconfiguredReceiptJudge } from './edges';
import { parseEnv } from './env';
import { WorkerRuntime } from './worker/runtime';

// Separate from HTTP (ADR 0015): a crashed worker never takes down checkout.
// Same modules as the API, as an application context without an HTTP listener.
const env = parseEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = await NestFactory.createApplicationContext(
  AppModule.register({
    env,
    db,
    edges: {
      clock: new SystemClock(),
      telegram: new GrammySender(env.BOT_TOKEN),
      receiptJudge: new UnconfiguredReceiptJudge(),
      files: new LocalFileStore(env.FILES_DIR),
    },
  }),
);
app.enableShutdownHooks();
const worker = app.get(WorkerRuntime);
worker.start();
const run = () => worker.tick().catch((e: Error) => console.error(`tick failed: ${e.message}`));
await run();
const timer = setInterval(run, 60_000);
console.log('worker started');
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void app.close().then(() => pool.end());
  });
}
