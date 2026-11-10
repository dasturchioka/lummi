/** Deadlock detected, serialization failure: Postgres gave up on the transaction, not on the request. */
const TRANSIENT = new Set(['40P01', '40001']);

/** A deadlock or serialization failure survived the retry: the caller answers 409 `try_again`. */
export class TryAgainError extends Error {
  constructor(cause: unknown) {
    super('the database gave up twice on a transient conflict', { cause });
  }
}

/** True for a deadlock or serialization failure, whether or not Drizzle wrapped the driver error. */
export function isTransient(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Runs `run` (a whole transaction) and, when Postgres aborts it as a deadlock victim or for a
 * serialization failure, runs it once more. A second transient failure becomes `TryAgainError`,
 * so the caller answers a clean 409 instead of a 500; anything else is rethrown as it is.
 */
export async function retryTransientOnce<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isTransient(e)) throw e;
  }
  try {
    return await run();
  } catch (e) {
    if (isTransient(e)) throw new TryAgainError(e);
    throw e;
  }
}
