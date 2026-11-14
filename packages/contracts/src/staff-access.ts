import { z } from 'zod';

/**
 * Staff sign-in by login and password (ADR 0038). A login is 3–32 characters of Latin letters,
 * digits, `.`, `_` and `-`; letters fold to lower case, so it is unique case-insensitively.
 */
export const STAFF_LOGIN_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const staffLoginSchema = z.string().trim().toLowerCase().regex(STAFF_LOGIN_PATTERN);

/**
 * The longest password taken: a hard ceiling against hashing megabytes, not a rule (the shortest
 * is the setting `auth.passwordMinLength`).
 */
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

/** Letters and digits without the look-alikes (0/O, 1/l/I): a password read off a screen. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** About 93 bits; longer when the minimum length asks for more. */
export const TEMPORARY_PASSWORD_LENGTH = 16;

/**
 * A temporary password from a source of random bytes (`crypto.getRandomValues` in the browser,
 * `randomBytes` on the server), with no bias: bytes past the last whole alphabet are dropped.
 */
export function generatePassword(
  minLength: number,
  randomBytes: (n: number) => Uint8Array,
): string {
  const length = Math.max(TEMPORARY_PASSWORD_LENGTH, minLength);
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

/**
 * «Привязать Telegram»: the bot's `/start` payload is `staff_<token>` (token: 32 base64url
 * characters), well inside Telegram's 64 and apart from the Mini App's `startapp` values.
 */
export const STAFF_LINK_START = /^staff_([A-Za-z0-9_-]{32})$/;
export const staffLinkStartParam = (token: string): string => `staff_${token}`;
