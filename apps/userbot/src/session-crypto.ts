import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The mtcute session string is full access to a personal Telegram account (ADR 0014). At rest it is
 * sealed with AES-256-GCM under `USERBOT_SESSION_KEY` from `.env` and kept in one file on the
 * server, never in the repo. Errors here never quote the session, the key or the file's content.
 *
 * Format: `lummi-userbot-session.v1.<iv>.<ciphertext>.<tag>`, each part base64url. The version
 * prefix is also the GCM additional data, so a sealed value cannot be replayed as another format.
 */

const PREFIX = 'lummi-userbot-session.v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Anything wrong with the session file or key; the message is safe to log. */
export class SessionFileError extends Error {
  override name = 'SessionFileError';
}

/** The key from `.env`: exactly 32 bytes in base64 (`openssl rand -base64 32`). */
export function parseSessionKey(base64: string): Buffer {
  const trimmed = base64.trim();
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) ? Buffer.from(trimmed, 'base64') : null;
  if (!key || key.length !== 32) {
    throw new SessionFileError('USERBOT_SESSION_KEY must be 32 bytes in base64');
  }
  return key;
}

export function sealSession(session: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(PREFIX));
  const body = Buffer.concat([cipher.update(session, 'utf8'), cipher.final()]);
  return [PREFIX, iv, body, cipher.getAuthTag()]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function openSession(sealed: string, key: Buffer): string {
  const parts = sealed.trim().split('.');
  const [iv, body, tag] = parts.slice(2).map((p) => Buffer.from(p, 'base64url'));
  if (parts.length !== 5 || `${parts[0]}.${parts[1]}` !== PREFIX || !iv || !body || !tag) {
    throw new SessionFileError('the session file is not a sealed LUMMI userbot session');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(PREFIX));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key or a changed file; the cause would add nothing safe to say.
    throw new SessionFileError(
      'the session file cannot be decrypted: USERBOT_SESSION_KEY is not the key it was sealed with, or the file was changed',
    );
  }
}

/**
 * Write the sealed session: the folder is made owner-only (0700), the file is written owner-only
 * (0600) beside the target and renamed over it, so a crash never leaves half a file.
 */
export async function writeSessionFile(path: string, sealed: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  await rm(tmp, { force: true });
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(`${sealed}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}

/** Read the sealed session; refuses a missing file and one that others may read. */
export async function readSessionFile(path: string): Promise<string> {
  let mode: number;
  try {
    mode = (await stat(path)).mode;
  } catch {
    throw new SessionFileError(
      `no session file at ${path}: log in first (docs/run-guide.md → Userbot)`,
    );
  }
  if (mode & 0o077) {
    throw new SessionFileError(
      `the session file ${path} is readable by others: chmod 600 it (and check who could have copied it)`,
    );
  }
  return readFile(path, 'utf8');
}
