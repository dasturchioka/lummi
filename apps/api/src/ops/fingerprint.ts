import { DrizzleQueryError } from '@lummi/db';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

/** What identifies an error in the `error_events` table; none of it can hold personal data (ADR 0035). */
export interface ErrorSignature {
  errorClass: string;
  route: string;
  frames: string;
  fingerprint: string;
}

const FRAMES_KEPT = 3;
const ROUTE_MAX = 200;
const UUID_OR_HEX = /^[0-9a-f-]{16,}$/i;

/** A path segment that is an id, a hash, a token or a number is replaced; words (`orders`, `receipt`) stay. */
function normaliseSegment(segment: string): string {
  if (/^\d+$/.test(segment) || UUID_OR_HEX.test(segment)) return ':id';
  if (segment.length >= 8 && /\d/.test(segment)) return ':id';
  return segment;
}

/** `GET`, `/orders/123/receipt?x=1` becomes `GET /orders/:id/receipt`. The query string is dropped, never parsed. */
export function normaliseRoute(method: string, path: string): string {
  const pathOnly = path.split(/[?#]/, 1)[0] ?? '';
  const normalised = pathOnly.split('/').map(normaliseSegment).join('/') || '/';
  return `${method.toUpperCase()} ${normalised}`.slice(0, ROUTE_MAX);
}

function findQueryError(e: unknown, depth = 0): DrizzleQueryError | null {
  if (e instanceof DrizzleQueryError) return e;
  if (depth > 3 || typeof e !== 'object' || e === null) return null;
  const { cause, error } = e as { cause?: unknown; error?: unknown };
  return findQueryError(cause, depth + 1) ?? findQueryError(error, depth + 1);
}

/** The class a thrown value is filed under: a failed query by its SQLSTATE (never its message or parameters). */
export function errorClassOf(e: unknown): string {
  const query = findQueryError(e);
  if (query) {
    const code = (query.cause as { code?: unknown } | undefined)?.code;
    return `QueryError:${typeof code === 'string' ? code : 'unknown'}`;
  }
  if (e instanceof Error) {
    const name = e.constructor?.name;
    return name && name !== 'Error' ? name : e.name;
  }
  return 'NonError';
}

/**
 * The first application frames as `function file.ts`: no line numbers (they move with every
 * deploy), no node_modules, no node internals, and never the stack's first line (the message).
 */
export function framesOf(e: unknown): string {
  const stack = findQueryError(e)?.stack ?? (e instanceof Error ? e.stack : undefined);
  if (!stack) return '';
  const frames: string[] = [];
  for (const line of stack.split('\n')) {
    const m = /^\s+at (?:async )?(?:(.+?) \()?(.+?):\d+:\d+\)?$/.exec(line);
    if (!m) continue;
    const [, fn, file] = m;
    if (!file || file.includes('node_modules') || file.startsWith('node:')) continue;
    frames.push(`${fn ?? 'anonymous'} ${basename(file.replace(/^file:\/\//, ''))}`);
    if (frames.length === FRAMES_KEPT) break;
  }
  return frames.join(' < ');
}

export function signError(e: unknown, route: string): ErrorSignature {
  const errorClass = errorClassOf(e);
  const frames = framesOf(e);
  const fingerprint = createHash('sha256')
    .update(`${errorClass}\n${route}\n${frames}`)
    .digest('hex')
    .slice(0, 32);
  return { errorClass, route, frames, fingerprint };
}
