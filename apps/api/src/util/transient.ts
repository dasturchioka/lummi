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
 * A transaction found the world moved under it in a way our own code detects (not Postgres): what
 * it read before taking its locks changed meanwhile. Thrown to roll back and run once more, like a
 * transient failure (`retryTransientOnce`).
 */
export class RetryableConflictError extends Error {}

/** A failure worth one more run: Postgres's transient ones, or our own `RetryableConflictError`. */
function isRetryable(e: unknown): boolean {
  return e instanceof RetryableConflictError || isTransient(e);
}

/**
 * Runs `run` (a whole transaction) and, when Postgres aborts it as a deadlock victim or for a
 * serialization failure, or it throws `RetryableConflictError`, runs it once more. A second such
 * failure becomes `TryAgainError`, so the caller answers a clean 409 instead of a 500; anything
 * else is rethrown as it is.
 */
export async function retryTransientOnce<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isRetryable(e)) throw e;
  }
  try {
    return await run();
  } catch (e) {
    if (isRetryable(e)) throw new TryAgainError(e);
    throw e;
  }
}

/**
 * `retryTransientOnce` for a service that answers with an outcome: a second transient failure
 * becomes `tryAgain` (the caller's 409 `try_again`) instead of a thrown error.
 */
export async function retryOrTryAgain<T>(run: () => Promise<T>, tryAgain: T): Promise<T> {
  try {
    return await retryTransientOnce(run);
  } catch (e) {
    if (e instanceof TryAgainError) return tryAgain;
    throw e;
  }
}

/**
 * The unique index a write ran into (SQLSTATE 23505), or null for any other error, whether or not
 * Drizzle wrapped the driver error.
 */
export function uniqueViolation(e: unknown): string | null {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; depth++) {
    const { code, constraint } = cur as { code?: unknown; constraint?: unknown };
    if (code === '23505') return typeof constraint === 'string' ? constraint : '';
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}
