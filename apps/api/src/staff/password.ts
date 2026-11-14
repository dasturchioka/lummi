import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';

/**
 * Staff passwords (ADR 0038): argon2id from Node's own `node:crypto` (OpenSSL, no dependency and
 * no native build), stored as a PHC string so the cost can rise later without breaking old hashes.
 * The cost is OWASP's argon2id baseline (19 MiB, 2 passes, 1 lane): a cryptographic parameter,
 * not a shop rule, so it is not a setting.
 */
type Cost = { memory: number; passes: number; parallelism: number };
const COST: Cost = { memory: 19_456, passes: 2, parallelism: 1 };
const SALT_BYTES = 16;
const TAG_BYTES = 32;

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

let derivations = 0;
/** How many argon2 derivations this process has run: the lock test counts the guesses checked. */
export const argon2Derivations = () => derivations;

function derive(password: string, salt: Buffer, cost: Cost, tagLength: number) {
  derivations++;
  const params: Argon2Parameters = { message: password, nonce: salt, tagLength, ...cost };
  return new Promise<Buffer>((ok, fail) =>
    argon2('argon2id', params, (err, key) => (err ? fail(err) : ok(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, COST, TAG_BYTES);
  const { memory: m, passes: t, parallelism: p } = COST;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(tag)}`;
}

const PHC =
  /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=(\d{1,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** A hash of nothing in particular: checking a missing account costs what checking a real one does. */
let decoy: Promise<string> | undefined;

/**
 * True when `password` matches the stored PHC string. With no stored hash (no such login, or a
 * Telegram-only account) it still runs one derivation, so the answer takes as long either way.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parsed = stored ? PHC.exec(stored) : null;
  if (!parsed) {
    decoy ??= hashPassword(randomBytes(16).toString('hex'));
    await verifyPassword(password, await decoy);
    return false;
  }
  const [, m, t, p, salt, tag] = parsed as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(tag, 'base64');
  const actual = await derive(
    password,
    Buffer.from(salt, 'base64'),
    { memory: Number(m), passes: Number(t), parallelism: Number(p) },
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}
