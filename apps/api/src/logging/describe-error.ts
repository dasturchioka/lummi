import { DrizzleQueryError } from '@lummi/db';

/**
 * The one line that may be logged (or stored, or sent in an alert) about a thrown value.
 *
 * A Drizzle query error's message and stack carry the query's parameters, and those hold personal
 * data: raw Humo messages, names, phones, addresses. So a query error is reduced to its driver
 * cause: SQLSTATE and message. The pg `detail` (row values) is dropped, and so is the message of a
 * data exception (SQLSTATE class 22), which may quote the input. A wrapper whose `cause` (or
 * grammY's `error`) is a query error keeps only its name, since its message often repeats the
 * inner one. Anything else logs as `name: message`.
 */
export function describeError(e: unknown): string {
  const query = findQueryError(e);
  if (query) {
    const inner = describeQueryError(query);
    return query === e ? inner : `${(e as Error).name}: ${inner}`;
  }
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return `non-error thrown (${typeof e})`;
}

function findQueryError(e: unknown, depth = 0): DrizzleQueryError | null {
  if (e instanceof DrizzleQueryError) return e;
  if (depth > 3 || typeof e !== 'object' || e === null) return null;
  const { cause, error } = e as { cause?: unknown; error?: unknown };
  return findQueryError(cause, depth + 1) ?? findQueryError(error, depth + 1);
}

function describeQueryError(e: DrizzleQueryError): string {
  const cause = e.cause as (Error & { code?: unknown }) | undefined;
  if (!cause) return 'query failed';
  const code = typeof cause.code === 'string' ? cause.code : null;
  if (code?.startsWith('22')) return `query failed: [${code}] data exception`;
  return `query failed: ${code ? `[${code}] ` : ''}${cause.message}`;
}
