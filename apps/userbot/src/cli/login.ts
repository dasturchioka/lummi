/**
 * Log the userbot into the account that receives the Humo notifications (ADR 0014). Run by a person,
 * once, on the server, in the userbot container (docs/run-guide.md → Userbot):
 *   docker compose run --rm userbot node --import tsx src/cli/login.ts [--force]
 * It asks for the phone, the code Telegram sends and the 2FA password, then seals the session into
 * USERBOT_SESSION_FILE with USERBOT_SESSION_KEY. Nothing secret is printed.
 */
import { loginEnvSchema, parseEnv } from '../env';
import { login } from '../login';
import { createTelegramClient } from '../mtcute-client';
import { parseSessionKey } from '../session-crypto';
import { describeError } from '../telegram';
import { terminalPrompt } from './prompt';

const env = parseEnv(loginEnvSchema, process.env);
const prompt = terminalPrompt();
try {
  await login({
    client: createTelegramClient({ apiId: env.USERBOT_API_ID, apiHash: env.USERBOT_API_HASH }),
    prompt,
    sessionFile: env.USERBOT_SESSION_FILE,
    key: parseSessionKey(env.USERBOT_SESSION_KEY),
    force: process.argv.includes('--force'),
  });
} catch (e) {
  prompt.say(`Login failed: ${describeError(e)}`);
  process.exitCode = 1;
} finally {
  prompt.close();
}
