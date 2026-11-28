import { createDb } from '@lummi/db';
import { SystemClock } from '../edges';
import { setOwnerPassword } from '../staff/seed-owner';
import { parseSetOwnerPasswordArgs } from './seed-owner-args';

/**
 * Give an owner a new temporary password (first set-up, or a lost one):
 *   npm run set-owner-password -w @lummi/api -- --login fayzali
 * The password is generated, printed here once and stored only as its argon2id hash. The owner
 * signs in with it and must set their own at once; every session they had ends now.
 */
const { login } = parseSetOwnerPasswordArgs(process.argv.slice(2));
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { db, pool } = createDb(url, 1);
try {
  const { staff, password } = await setOwnerPassword(db, new SystemClock().now(), login);
  // the one place a password is shown: this terminal, once (never a log line in the API)
  process.stdout.write(
    `Temporary password for ${staff.name} (login ${login}):\n\n    ${password}\n\n` +
      'Sign in with it in the admin panel; it asks for a new password at once. ' +
      'Every earlier session of this owner has ended.\n',
  );
} finally {
  await pool.end();
}
