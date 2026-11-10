import { dictionaries } from '@lummi/i18n/all';
import type { Env } from '../env';
import { ALLOWED_UPDATES } from './bot.service';

/** The two Bot API calls `setupBot` makes; grammY's `bot.api` fits it, tests pass a fake. */
export interface BotSetupApi {
  setWebhook(
    url: string,
    other: {
      secret_token: string;
      allowed_updates: (typeof ALLOWED_UPDATES)[number][];
      drop_pending_updates: boolean;
    },
  ): Promise<unknown>;
  setChatMenuButton(other: {
    menu_button: { type: 'web_app'; text: string; web_app: { url: string } };
  }): Promise<unknown>;
}

/**
 * The deploy's one-off (ADR 0024): point Telegram at this stack. Idempotent, safe to repeat.
 * `drop_pending_updates` stays false so a redeploy never loses updates Telegram is holding.
 * Returns what it did, for the deploy log (no secrets in it).
 */
export async function setupBot(api: BotSetupApi, env: Env): Promise<string[]> {
  if (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_URL and WEBHOOK_SECRET are required');
  }
  if (!env.MINIAPP_URL) throw new Error('MINIAPP_URL is required');
  await api.setWebhook(env.WEBHOOK_URL, {
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: [...ALLOWED_UPDATES],
    drop_pending_updates: false,
  });
  // The default (all chats) button is Russian; /start sets each customer's own language.
  await api.setChatMenuButton({
    menu_button: {
      type: 'web_app',
      text: dictionaries.ru.bot.openShop,
      web_app: { url: env.MINIAPP_URL },
    },
  });
  return [`webhook -> ${env.WEBHOOK_URL}`, `menu button -> ${env.MINIAPP_URL}`];
}
