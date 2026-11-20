import { SHOT_CARD, connectShotDb } from '../shots/db';
import { startStack } from '../shots/stack';
import { E2E } from './env';

/** Starts the disposable stack once for the run and returns its teardown (Playwright calls it at the end). */
export default async function globalSetup() {
  if (!E2E.botToken) throw new Error('BOT_TOKEN is not set (it signs initData); see .env.example');
  const stack = await startStack({ ...E2E, removeVolumes: true });
  // checkout is closed without a shop card (#28)
  const db = connectShotDb(stack.databaseUrl);
  try {
    await db.shopCard(SHOT_CARD);
  } finally {
    await db.end();
  }
  // E2E_KEEP_STACK=1 leaves it running for quick reruns while writing the test (stop it by hand)
  return () => (process.env.E2E_KEEP_STACK ? undefined : stack.stop());
}
