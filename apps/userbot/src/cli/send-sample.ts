/**
 * Dev and staging only (ADR 0023): our test bot sends a sample Humo message to the account the
 * userbot runs on, which listens to that bot (USERBOT_LISTEN_CHAT_ID = the test bot's id).
 *   npm run humo:sample -w @lummi/userbot -- credit 99000 --card 1234
 *   npm run humo:sample -w @lummi/userbot -- debit 75750
 *   npm run humo:sample -w @lummi/userbot -- other
 * Env: HUMO_TEST_BOT_TOKEN (the test bot, never the shop's bot), HUMO_TEST_CHAT_ID (the user id of
 * the userbot's account; that account must have pressed Start in the test bot once).
 */
import { z } from 'zod';
import { parseEnv } from '../env';
import { botIdFromToken, parseSampleArgs, sampleText, sendSample } from '../send-sample';

const env = parseEnv(
  z.object({
    NODE_ENV: z.string().default('development'),
    HUMO_TEST_BOT_TOKEN: z.string().min(1, 'the test bot token from @BotFather'),
    HUMO_TEST_CHAT_ID: z.coerce.number().int().positive(),
    BOT_TOKEN: z.string().optional(),
  }),
  process.env,
);
if (env.NODE_ENV === 'production') {
  console.error('send-sample is for development and staging only');
  process.exit(2);
}
if (env.BOT_TOKEN && env.HUMO_TEST_BOT_TOKEN === env.BOT_TOKEN) {
  console.error('HUMO_TEST_BOT_TOKEN must be a bot of its own, not the shop bot (BOT_TOKEN)');
  process.exit(2);
}

try {
  const args = parseSampleArgs(process.argv.slice(2), new Date());
  await sendSample({
    token: env.HUMO_TEST_BOT_TOKEN,
    chatId: env.HUMO_TEST_CHAT_ID,
    text: sampleText(args),
  });
  console.log(
    `sent a ${args.kind} sample. The userbot must listen to this bot: USERBOT_LISTEN_CHAT_ID=${botIdFromToken(env.HUMO_TEST_BOT_TOKEN)}`,
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
