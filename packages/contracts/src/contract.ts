import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { authErrorSchema, customerSchema, sessionSchema, telegramAuthBodySchema } from './auth';
import {
  humoLastMessageIdSchema,
  humoMessageBodySchema,
  humoMessageResultSchema,
  internalErrorSchema,
} from './internal';

const c = initContract();

export const contract = c.router({
  auth: {
    telegram: {
      method: 'POST',
      path: '/auth/telegram',
      body: telegramAuthBodySchema,
      responses: { 200: sessionSchema, 401: authErrorSchema },
      summary: 'Exchange Telegram initData for our own short-lived customer session (ADR 0029)',
    },
    refresh: {
      method: 'POST',
      path: '/auth/refresh',
      body: c.noBody(),
      responses: { 200: sessionSchema, 401: authErrorSchema },
      summary: 'Swap a still-valid session (Bearer) for a new one with a fresh expiry',
    },
  },
  me: {
    get: {
      method: 'GET',
      path: '/me',
      responses: { 200: customerSchema, 401: authErrorSchema },
      summary: 'The signed-in customer, identified only by the session',
    },
  },
  /** Userbot only (ADR 0015): internal network, `x-internal-secret` header. */
  internal: {
    humoMessage: {
      method: 'POST',
      path: '/internal/humo/messages',
      body: humoMessageBodySchema,
      responses: {
        200: humoMessageResultSchema,
        401: internalErrorSchema,
        403: internalErrorSchema,
      },
      summary: 'Record one Humo bot message: a ➕ becomes a credit; idempotent on messageId',
    },
    humoLastMessageId: {
      method: 'GET',
      path: '/internal/humo/last-message-id',
      responses: {
        200: humoLastMessageIdSchema,
        401: internalErrorSchema,
        403: internalErrorSchema,
      },
      summary: 'Where the userbot resumes reading the Humo chat after a restart',
    },
    userbotHeartbeat: {
      method: 'POST',
      path: '/internal/userbot/heartbeat',
      body: z.object({}),
      responses: {
        200: z.object({ ok: z.literal(true) }),
        401: internalErrorSchema,
        403: internalErrorSchema,
      },
      summary: 'The userbot is alive (every minute); feeds the Humo-silence guard (ADR 0012)',
    },
  },
});
