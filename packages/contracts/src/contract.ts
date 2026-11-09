import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import {
  adminErrorSchema,
  createManagerBodySchema,
  devLoginBodySchema,
  loginWidgetBodySchema,
  staffSchema,
  updateStaffBodySchema,
} from './admin';
import {
  authErrorSchema,
  customerSchema,
  preferencesBodySchema,
  sessionSchema,
  telegramAuthBodySchema,
} from './auth';
import {
  humoLastMessageIdSchema,
  humoMessageBodySchema,
  humoMessageResultSchema,
  internalErrorSchema,
} from './internal';

const c = initContract();

/** Customer-facing routes (Mini App). The Mini App client table must mirror exactly this router. */
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
    updatePreferences: {
      method: 'PATCH',
      path: '/me/preferences',
      body: preferencesBodySchema,
      responses: { 200: customerSchema, 401: authErrorSchema },
      summary: 'Save the customer language and/or theme (the bot reads the language too)',
    },
  },
});

/** Staff-facing routes (admin panel). Not part of the Mini App's client table (`./client`). */
export const adminContract = c.router({
  loginWidget: {
    method: 'POST',
    path: '/admin/auth/telegram',
    body: loginWidgetBodySchema,
    responses: { 200: staffSchema, 401: adminErrorSchema, 403: adminErrorSchema },
    summary: 'Telegram Login Widget sign-in; sets the httpOnly staff session cookie (ADR 0017)',
  },
  devLogin: {
    method: 'POST',
    path: '/admin/auth/dev',
    body: devLoginBodySchema,
    responses: { 200: staffSchema, 403: adminErrorSchema, 404: adminErrorSchema },
    summary: 'Dev/test only: sign in as an active staff member without the widget',
  },
  logout: {
    method: 'POST',
    path: '/admin/auth/logout',
    body: c.noBody(),
    responses: { 200: z.object({ ok: z.literal(true) }) },
    summary: 'Revoke the current staff session and clear the cookie',
  },
  me: {
    method: 'GET',
    path: '/admin/me',
    responses: { 200: staffSchema, 401: adminErrorSchema },
    summary: 'The signed-in staff member, identified only by the session cookie',
  },
  staff: {
    list: {
      method: 'GET',
      path: '/admin/staff',
      responses: { 200: z.array(staffSchema), 401: adminErrorSchema, 403: adminErrorSchema },
      summary: 'Owner only: every staff member',
    },
    create: {
      method: 'POST',
      path: '/admin/staff',
      body: createManagerBodySchema,
      responses: {
        201: staffSchema,
        401: adminErrorSchema,
        403: adminErrorSchema,
        409: adminErrorSchema,
      },
      summary: 'Owner only: add a manager by Telegram id',
    },
    update: {
      method: 'PATCH',
      path: '/admin/staff/:id',
      pathParams: z.object({ id: z.coerce.number().int().positive() }),
      body: updateStaffBodySchema,
      responses: {
        200: staffSchema,
        401: adminErrorSchema,
        403: adminErrorSchema,
        404: adminErrorSchema,
        409: adminErrorSchema,
      },
      summary: 'Owner only: deactivate (revokes sessions) or reactivate a manager',
    },
    remove: {
      method: 'DELETE',
      path: '/admin/staff/:id',
      pathParams: z.object({ id: z.coerce.number().int().positive() }),
      body: c.noBody(),
      responses: {
        200: z.object({ ok: z.literal(true) }),
        401: adminErrorSchema,
        403: adminErrorSchema,
        404: adminErrorSchema,
        409: adminErrorSchema,
      },
      summary: 'Owner only: remove a manager',
    },
  },
});

/** Userbot only (ADR 0031): internal network, `x-internal-secret` header; never the Mini App or admin. */
export const internalContract = c.router({
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
});

/** Every router under one client, for tests that drive the whole API. */
export const apiContract = c.router({
  ...contract,
  admin: adminContract,
  internal: internalContract,
});
