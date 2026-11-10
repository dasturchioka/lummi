import { expect, it, vi } from 'vitest';
import { setupBot } from '../src/bot/bot-setup';
import { parseEnv } from '../src/env';

const base = {
  DATABASE_URL: 'postgres://x',
  BOT_TOKEN: 't',
  SESSION_SECRET: 's'.repeat(32),
  WEBHOOK_URL: 'https://api.lummi.example/telegram/webhook',
  WEBHOOK_SECRET: 'hook_secret-1',
  MINIAPP_URL: 'https://lummi.example/',
};

it('sets the webhook (keeping pending updates) and the Mini App menu button', async () => {
  const api = { setWebhook: vi.fn(async () => true), setChatMenuButton: vi.fn(async () => true) };
  const lines = await setupBot(api, parseEnv(base));
  expect(api.setWebhook).toHaveBeenCalledWith('https://api.lummi.example/telegram/webhook', {
    secret_token: 'hook_secret-1',
    allowed_updates: ['message', 'my_chat_member'],
    drop_pending_updates: false,
  });
  expect(api.setChatMenuButton).toHaveBeenCalledWith({
    menu_button: {
      type: 'web_app',
      text: expect.any(String),
      web_app: { url: 'https://lummi.example/' },
    },
  });
  expect(lines.join('\n')).not.toContain('hook_secret-1');
});

it('refuses to run without the webhook settings or the Mini App URL', async () => {
  const api = { setWebhook: vi.fn(), setChatMenuButton: vi.fn() };
  await expect(setupBot(api, parseEnv({ ...base, WEBHOOK_SECRET: undefined }))).rejects.toThrow(
    /WEBHOOK/,
  );
  await expect(setupBot(api, parseEnv({ ...base, MINIAPP_URL: undefined }))).rejects.toThrow(
    /MINIAPP_URL/,
  );
  expect(api.setWebhook).not.toHaveBeenCalled();
});
