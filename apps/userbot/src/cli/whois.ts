/**
 * Print a bot's numeric id, for USERBOT_LISTEN_CHAT_ID, using the stored session (read-only: one
 * username lookup). Check `verified: true` before trusting it as the official Humo bot.
 *   docker compose run --rm userbot node --import tsx src/cli/whois.ts @SomeBot
 */
import { loginEnvSchema, parseEnv } from '../env';
import { createTelegramClient } from '../mtcute-client';
import { openSession, parseSessionKey, readSessionFile } from '../session-crypto';
import { describeError } from '../telegram';

const username = process.argv[2]?.replace(/^@/, '');
if (!username || !/^[A-Za-z0-9_]{4,32}$/.test(username)) {
  console.error('usage: whois.ts @username');
  process.exit(2);
}

const env = parseEnv(loginEnvSchema, process.env);
const client = createTelegramClient({ apiId: env.USERBOT_API_ID, apiHash: env.USERBOT_API_HASH });
try {
  const key = parseSessionKey(env.USERBOT_SESSION_KEY);
  await client.importSession(openSession(await readSessionFile(env.USERBOT_SESSION_FILE), key));
  const user = await client.getUser(username);
  console.log(
    `@${username}: id ${user.id}, bot: ${user.isBot}, verified: ${user.isVerified}, scam: ${user.isScam}, fake: ${user.isFake}`,
  );
} catch (e) {
  console.error(`whois failed: ${describeError(e)}`);
  process.exitCode = 1;
} finally {
  await client.destroy();
}
