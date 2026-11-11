/**
 * Runs `fn` on every item in turn; one that throws does not hold up the others. The first failure
 * is rethrown at the end, so a sweep still reports it (and the worker alerts after repeated ones).
 */
export async function forEachSettled<T>(
  items: Iterable<T>,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const item of items) {
    try {
      await fn(item);
    } catch (e) {
      failures.push(e);
    }
  }
  if (failures.length > 0) throw failures[0];
}
