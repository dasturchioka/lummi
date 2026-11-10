import { Bot } from 'grammy';
import { setupBot } from '../bot/bot-setup';
import { parseEnv } from '../env';

/**
 * Set the bot's webhook and menu button; the deploy runs it after `up -d`:
 *   docker compose run --rm api node --import tsx src/cli/bot-setup.ts
 * Reads BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET, MINIAPP_URL from the environment. Idempotent.
 */
const env = parseEnv();
const bot = new Bot(env.BOT_TOKEN);
for (const line of await setupBot(bot.api, env)) console.log(line);
const info = await bot.api.getWebhookInfo();
console.log(
  `Telegram reports: url ${info.url}, ${info.pending_update_count} pending` +
    (info.last_error_message ? `, last error: ${info.last_error_message}` : ''),
);
