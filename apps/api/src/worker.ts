import { createDb } from '@lummi/db';
import { GrammySender, LocalFileStore, SystemClock, UnconfiguredReceiptJudge } from './edges';
import { parseEnv } from './env';
import { WorkerRuntime } from './worker/runtime';

// Separate from HTTP (ADR 0015): a crashed worker never takes down checkout.
const env = parseEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const worker = new WorkerRuntime({
  env,
  db,
  edges: {
    clock: new SystemClock(),
    telegram: new GrammySender(env.BOT_TOKEN),
    receiptJudge: new UnconfiguredReceiptJudge(),
    files: new LocalFileStore(env.FILES_DIR),
  },
});
worker.start();
const run = () => worker.tick().catch((e: Error) => console.error(`tick failed: ${e.message}`));
await run();
const timer = setInterval(run, 60_000);
console.log('worker started');
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void worker.close().then(() => pool.end());
  });
}
