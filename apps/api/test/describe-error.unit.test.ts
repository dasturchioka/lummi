import { DrizzleQueryError } from '@lummi/db';
import { describe, expect, it } from 'vitest';
import { describeError } from '../src/logging/describe-error';

/** A pg DatabaseError as the driver throws it: message, SQLSTATE, and a detail that quotes values. */
function pgError(message: string, fields: Record<string, string>): Error {
  return Object.assign(new Error(message), { name: 'error', ...fields });
}

const PARAMS = ['Kartangiz bloklandi', '+998901234567'];

describe('describeError: what may be logged about a thrown value', () => {
  it.each([
    [
      'query error: only the driver cause, never the params or the SQL',
      new DrizzleQueryError(
        'insert into "humo_messages" values ($1, $2)',
        PARAMS,
        pgError('relation "humo_messages" does not exist', { code: '42P01' }),
      ),
      'query failed: [42P01] relation "humo_messages" does not exist',
    ],
    [
      'constraint names are kept, the detail (row values) is not',
      new DrizzleQueryError(
        'insert ...',
        PARAMS,
        pgError('duplicate key value violates unique constraint "customers_phone_unique"', {
          code: '23505',
          detail: 'Key (phone)=(+998901234567) already exists.',
        }),
      ),
      'query failed: [23505] duplicate key value violates unique constraint "customers_phone_unique"',
    ],
    [
      'a data exception (class 22) may quote the input, so only its code',
      new DrizzleQueryError(
        'select ...',
        PARAMS,
        pgError('invalid input syntax for type bigint: "+998901234567"', { code: '22P02' }),
      ),
      'query failed: [22P02] data exception',
    ],
    ['query error without a cause', new DrizzleQueryError('select 1', PARAMS), 'query failed'],
    ['an ordinary error', new TypeError('x is not a function'), 'TypeError: x is not a function'],
    ['not an Error', { params: PARAMS }, 'non-error thrown (object)'],
  ])('%s', (_name, error, expected) => {
    expect(describeError(error)).toBe(expected);
  });

  it('drops a wrapper message that may repeat the params, and names the wrapper', () => {
    const inner = new DrizzleQueryError('select', PARAMS, pgError('boom', { code: '57014' }));
    // Error.cause, and grammY's BotError, which keeps the handler's error in `.error`
    // and copies its message into its own.
    const withCause = new Error(`failed: ${inner.message}`, { cause: inner });
    const botError = Object.assign(new Error(`Error in middleware: ${inner.message}`), {
      name: 'BotError',
      error: inner,
    });
    expect(describeError(withCause)).toBe('Error: query failed: [57014] boom');
    expect(describeError(botError)).toBe('BotError: query failed: [57014] boom');
  });
});
