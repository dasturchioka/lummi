import { generatePassword, TEMPORARY_PASSWORD_LENGTH } from '@lummi/contracts';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/staff/password';

describe('staff password hashing (argon2id, ADR 0038)', () => {
  it('verifies the reference implementation’s argon2id test vector', async () => {
    // phc-winner-argon2 test.c: argon2id v=19, t=2, m=2^16, p=1, "password" / "somesalt"
    const reference =
      '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc';
    expect(await verifyPassword('password', reference)).toBe(true);
    expect(await verifyPassword('Password', reference)).toBe(false);
  });

  it('stores an argon2id PHC string with its own salt, at the OWASP baseline cost', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct horse');
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('correct horse', b)).toBe(true);
    expect(await verifyPassword('correct hors', a)).toBe(false);
  });

  it('says no, after the same work, when there is no stored hash', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', 'not a phc string')).toBe(false);
  });
});

describe('generated temporary password', () => {
  it('is at least 16 characters, longer when the minimum asks, without look-alike characters', () => {
    const bytes = (n: number) => new Uint8Array(randomBytes(n));
    expect(TEMPORARY_PASSWORD_LENGTH).toBe(16);
    const pw = generatePassword(8, bytes);
    expect(pw).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{16}$/);
    expect(generatePassword(24, bytes)).toHaveLength(24);
    expect(generatePassword(8, bytes)).not.toBe(pw);
  });

  it('drops the bytes that would bias it', () => {
    // 56 letters: 224..255 would favour the first 32; a source giving only those plus one 0 byte
    let calls = 0;
    const biased = (n: number) => {
      calls++;
      return new Uint8Array(n).fill(calls === 1 ? 250 : 0);
    };
    expect(generatePassword(8, biased)).toBe('a'.repeat(16));
    expect(calls).toBe(2);
  });
});
