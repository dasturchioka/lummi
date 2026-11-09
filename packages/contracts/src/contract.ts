import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { addCartLineBodySchema, cartErrorSchema, cartSchema, setCartLineBodySchema } from './cart';
import {
  catalogErrorSchema,
  catalogQuerySchema,
  catalogResultSchema,
  fragranceCardSchema,
  searchQuerySchema,
  searchResultSchema,
  similarResultSchema,
} from './catalog';
import {
  catalogAdminErrorSchema,
  dictionaryInputSchema,
  dictionaryItemSchema,
  fragranceAdminSchema,
  fragranceInputSchema,
  adminFragranceListItemSchema,
  fragranceListQuerySchema,
  hiddenBodySchema,
  onHandBodySchema,
  onHandItemSchema,
} from './admin-catalog';
import {
  audienceCountSchema,
  audienceQuerySchema,
  broadcastBodySchema,
  broadcastErrorSchema,
  broadcastSchema,
  testSendResultSchema,
} from './broadcast';
import {
  adminErrorSchema,
  auditFiltersSchema,
  auditPageSchema,
  auditQuerySchema,
  settingErrorSchema,
  settingStateSchema,
  updateSettingBodySchema,
  createManagerBodySchema,
  devLoginBodySchema,
  loginWidgetBodySchema,
  staffSchema,
  updateStaffBodySchema,
} from './admin';
import {
  adminBtsPointSchema,
  adminDeliveryErrorSchema,
  adminPointsPageSchema,
  adminPointsQuerySchema,
  adminRegionSchema,
  btsPointSchema,
  citySchema,
  createBtsPointBodySchema,
  deliveryCityResponseSchema,
  deliveryErrorSchema,
  pointsQuerySchema,
  regionSchema,
  setDeliveryCityBodySchema,
  setTariffBodySchema,
  updateBtsPointBodySchema,
} from './delivery';
import {
  authErrorSchema,
  contactBodySchema,
  contactErrorSchema,
  contactResultSchema,
  writeAccessBodySchema,
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
    shareContact: {
      method: 'POST',
      path: '/me/contact',
      body: contactBodySchema,
      responses: {
        200: contactResultSchema,
        400: contactErrorSchema,
        401: authErrorSchema,
        403: contactErrorSchema,
        409: contactErrorSchema,
      },
      summary: 'Set the account phone from the signed requestContact payload (ADR 0004)',
    },
    writeAccess: {
      method: 'POST',
      path: '/me/write-access',
      body: writeAccessBodySchema,
      responses: { 200: customerSchema, 401: authErrorSchema },
      summary: 'Record the answer to requestWriteAccess; a refusal keeps statuses in the app',
    },
    getDeliveryCity: {
      method: 'GET',
      path: '/me/delivery-city',
      responses: { 200: deliveryCityResponseSchema, 401: deliveryErrorSchema },
      summary: 'The delivery city shown on Home, with its region and tariff; null until chosen',
    },
    setDeliveryCity: {
      method: 'PUT',
      path: '/me/delivery-city',
      body: setDeliveryCityBodySchema,
      responses: {
        200: deliveryCityResponseSchema,
        401: deliveryErrorSchema,
        404: deliveryErrorSchema,
        422: deliveryErrorSchema,
      },
      summary: 'Save region + city (a city that has an offered BTS point); never changes a price',
    },
    clearDeliveryCity: {
      method: 'DELETE',
      path: '/me/delivery-city',
      body: c.noBody(),
      responses: { 200: deliveryCityResponseSchema, 401: deliveryErrorSchema },
      summary: 'Forget the delivery city',
    },
  },
  delivery: {
    regions: {
      method: 'GET',
      path: '/delivery/regions',
      responses: { 200: z.array(regionSchema), 401: deliveryErrorSchema },
      summary: 'The 14 regions with their delivery tariff, in picker order',
    },
    cities: {
      method: 'GET',
      path: '/delivery/regions/:regionId/cities',
      pathParams: z.object({ regionId: z.coerce.number().int().positive() }),
      responses: { 200: z.array(citySchema), 401: deliveryErrorSchema, 404: deliveryErrorSchema },
      summary: 'Cities and districts of a region that have at least one offered BTS point',
    },
    points: {
      method: 'GET',
      path: '/delivery/points',
      query: pointsQuerySchema,
      responses: { 200: z.array(btsPointSchema), 401: deliveryErrorSchema },
      summary: 'Offered BTS points of a city (regionId + city), or a search across all regions (q)',
    },
  },
  catalog: {
    fragrance: {
      method: 'GET',
      path: '/catalog/fragrances/:slug',
      pathParams: z.object({ slug: z.string().min(1).max(100) }),
      responses: { 200: fragranceCardSchema, 401: authErrorSchema, 404: catalogErrorSchema },
      summary: 'A fragrance card by slug; hidden and unknown fragrances are 404',
    },
    list: {
      method: 'GET',
      path: '/catalog/fragrances',
      query: catalogQuerySchema,
      responses: { 200: catalogResultSchema, 401: authErrorSchema },
      summary:
        'The catalog list: filters (type, family, volume, price, season), sorts (top sales, new, price) and the total; hidden fragrances never appear',
    },
    similar: {
      method: 'GET',
      path: '/catalog/fragrances/:slug/similar',
      pathParams: z.object({ slug: z.string().min(1).max(100) }),
      responses: { 200: similarResultSchema, 401: authErrorSchema, 404: catalogErrorSchema },
      summary: 'Similar fragrances for a card: curated first, then same family and type, in stock',
    },
    suggest: {
      method: 'GET',
      path: '/catalog/suggest',
      query: searchQuerySchema,
      responses: { 200: searchResultSchema, 401: authErrorSchema },
      summary:
        'Suggestions while typing: the top few fragrances for a name or note, typos and either alphabet tolerated; empty under the minimum length (ADR 0019)',
    },
    search: {
      method: 'GET',
      path: '/catalog/search',
      query: searchQuerySchema,
      responses: { 200: searchResultSchema, 401: authErrorSchema },
      summary: 'Search results as list cards, best match first (ADR 0019)',
    },
  },
  cart: {
    get: {
      method: 'GET',
      path: '/cart',
      responses: { 200: cartSchema, 401: cartErrorSchema },
      summary: 'The customer cart, freshly quoted',
    },
    addLine: {
      method: 'POST',
      path: '/cart/lines',
      body: addCartLineBodySchema,
      responses: {
        200: cartSchema,
        401: cartErrorSchema,
        404: cartErrorSchema,
        409: cartErrorSchema,
      },
      summary: 'Add a volume (quantity capped at available); 409 sold_out when none is available',
    },
    setQuantity: {
      method: 'PATCH',
      path: '/cart/lines/:lineId',
      pathParams: z.object({ lineId: z.coerce.number().int().positive() }),
      body: setCartLineBodySchema,
      responses: { 200: cartSchema, 401: cartErrorSchema, 404: cartErrorSchema },
      summary: 'Set a line quantity, never above available',
    },
    removeLine: {
      method: 'DELETE',
      path: '/cart/lines/:lineId',
      pathParams: z.object({ lineId: z.coerce.number().int().positive() }),
      body: c.noBody(),
      responses: { 200: cartSchema, 401: cartErrorSchema },
      summary: 'Remove a line',
    },
  },
});

const adminCore = c.router({
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
  settings: {
    list: {
      method: 'GET',
      path: '/admin/settings',
      responses: { 200: z.array(settingStateSchema), 401: adminErrorSchema, 403: adminErrorSchema },
      summary: 'Owner only: the current value of every registered setting',
    },
    update: {
      method: 'PUT',
      path: '/admin/settings/:key',
      pathParams: z.object({ key: z.string().min(1).max(100) }),
      body: updateSettingBodySchema,
      responses: {
        200: settingStateSchema,
        400: settingErrorSchema,
        401: adminErrorSchema,
        403: adminErrorSchema,
        404: adminErrorSchema,
      },
      summary: 'Owner only: validate against the registry, store, and audit actor, old and new',
    },
  },
  audit: {
    list: {
      method: 'GET',
      path: '/admin/audit',
      query: auditQuerySchema,
      responses: { 200: auditPageSchema, 401: adminErrorSchema, 403: adminErrorSchema },
      summary:
        'Owner only: the audit trail, newest first, filtered by actor, action and Tashkent dates',
    },
    filters: {
      method: 'GET',
      path: '/admin/audit/filters',
      responses: { 200: auditFiltersSchema, 401: adminErrorSchema, 403: adminErrorSchema },
      summary: 'Owner only: the actors and action types the audit filters offer',
    },
  },
  catalog: {
    fragrances: {
      list: {
        method: 'GET',
        path: '/admin/catalog/fragrances',
        query: fragranceListQuerySchema,
        responses: {
          200: z.array(adminFragranceListItemSchema),
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
        },
        summary: 'Owner only: fragrances with search and filters, hidden ones included',
      },
      get: {
        method: 'GET',
        path: '/admin/catalog/fragrances/:id',
        pathParams: z.object({ id: z.coerce.number().int().positive() }),
        responses: {
          200: fragranceAdminSchema,
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
          404: catalogAdminErrorSchema,
        },
        summary: 'Owner only: every field of one fragrance',
      },
      create: {
        method: 'POST',
        path: '/admin/catalog/fragrances',
        body: fragranceInputSchema,
        responses: {
          201: fragranceAdminSchema,
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
          409: catalogAdminErrorSchema,
          422: catalogAdminErrorSchema,
        },
        summary: 'Owner only: create a fragrance with its notes, similar fragrances and volumes',
      },
      update: {
        method: 'PUT',
        path: '/admin/catalog/fragrances/:id',
        pathParams: z.object({ id: z.coerce.number().int().positive() }),
        body: fragranceInputSchema,
        responses: {
          200: fragranceAdminSchema,
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
          404: catalogAdminErrorSchema,
          409: catalogAdminErrorSchema,
          422: catalogAdminErrorSchema,
        },
        summary: 'Owner only: replace every editable field of a fragrance (volumes are upserted)',
      },
      setHidden: {
        method: 'PATCH',
        path: '/admin/catalog/fragrances/:id/hidden',
        pathParams: z.object({ id: z.coerce.number().int().positive() }),
        body: hiddenBodySchema,
        responses: {
          200: fragranceAdminSchema,
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
          404: catalogAdminErrorSchema,
        },
        summary: 'Owner only: hide or unhide a fragrance in the Mini App',
      },
    },
    families: {
      list: {
        method: 'GET',
        path: '/admin/catalog/families',
        responses: {
          200: z.array(dictionaryItemSchema),
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
        },
        summary: 'Owner only: the families dictionary with usage counts',
      },
      create: {
        method: 'POST',
        path: '/admin/catalog/families',
        body: dictionaryInputSchema,
        responses: {
          201: dictionaryItemSchema,
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
          409: catalogAdminErrorSchema,
        },
        summary: 'Owner only: add a dictionary entry',
      },
      update: {
        method: 'PUT',
        path: '/admin/catalog/families/:id',
        pathParams: z.object({ id: z.coerce.number().int().positive() }),
        body: dictionaryInputSchema,
        responses: {
          200: dictionaryItemSchema,
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
          404: catalogAdminErrorSchema,
          409: catalogAdminErrorSchema,
        },
        summary: 'Owner only: edit a dictionary entry',
      },
    },
    notes: {
      list: {
        method: 'GET',
        path: '/admin/catalog/notes',
        responses: {
          200: z.array(dictionaryItemSchema),
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
        },
        summary: 'Owner only: the notes dictionary with usage counts',
      },
      create: {
        method: 'POST',
        path: '/admin/catalog/notes',
        body: dictionaryInputSchema,
        responses: {
          201: dictionaryItemSchema,
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
          409: catalogAdminErrorSchema,
        },
        summary: 'Owner only: add a dictionary entry',
      },
      update: {
        method: 'PUT',
        path: '/admin/catalog/notes/:id',
        pathParams: z.object({ id: z.coerce.number().int().positive() }),
        body: dictionaryInputSchema,
        responses: {
          200: dictionaryItemSchema,
          401: catalogAdminErrorSchema,
          403: catalogAdminErrorSchema,
          404: catalogAdminErrorSchema,
          409: catalogAdminErrorSchema,
        },
        summary: 'Owner only: edit a dictionary entry',
      },
    },
  },
  onHand: {
    list: {
      method: 'GET',
      path: '/admin/on-hand',
      query: z.object({ q: z.string().trim().max(100).optional() }),
      responses: {
        200: z.array(onHandItemSchema),
        401: catalogAdminErrorSchema,
        403: catalogAdminErrorSchema,
      },
      summary: 'Owner and manager: on hand, reserve and available per volume',
    },
    set: {
      method: 'PATCH',
      path: '/admin/volumes/:id/on-hand',
      pathParams: z.object({ id: z.coerce.number().int().positive() }),
      body: onHandBodySchema,
      responses: {
        200: onHandItemSchema,
        401: catalogAdminErrorSchema,
        403: catalogAdminErrorSchema,
        404: catalogAdminErrorSchema,
      },
      summary: 'Owner and manager: set on hand for one volume (audited)',
    },
  },
});

/** Staff routes for BTS points and delivery tariffs. */
const adminDelivery = c.router({
  regions: {
    list: {
      method: 'GET',
      path: '/admin/regions',
      responses: { 200: z.array(adminRegionSchema), 401: adminDeliveryErrorSchema },
      summary: 'Staff: regions with tariff and point counts',
    },
    setTariff: {
      method: 'PATCH',
      path: '/admin/regions/:id',
      pathParams: z.object({ id: z.coerce.number().int().positive() }),
      body: setTariffBodySchema,
      responses: {
        200: adminRegionSchema,
        401: adminDeliveryErrorSchema,
        403: adminDeliveryErrorSchema,
        404: adminDeliveryErrorSchema,
      },
      summary: 'Owner only: change a region delivery tariff (audited)',
    },
  },
  btsPoints: {
    list: {
      method: 'GET',
      path: '/admin/bts-points',
      query: adminPointsQuerySchema,
      responses: { 200: adminPointsPageSchema, 401: adminDeliveryErrorSchema },
      summary: 'Staff: BTS points with region, status and text filters, 50 per page',
    },
    create: {
      method: 'POST',
      path: '/admin/bts-points',
      body: createBtsPointBodySchema,
      responses: {
        201: adminBtsPointSchema,
        401: adminDeliveryErrorSchema,
        409: adminDeliveryErrorSchema,
        422: adminDeliveryErrorSchema,
      },
      summary: 'Staff: add a BTS point',
    },
    update: {
      method: 'PATCH',
      path: '/admin/bts-points/:id',
      pathParams: z.object({ id: z.coerce.number().int().positive() }),
      body: updateBtsPointBodySchema,
      responses: {
        200: adminBtsPointSchema,
        401: adminDeliveryErrorSchema,
        404: adminDeliveryErrorSchema,
        422: adminDeliveryErrorSchema,
      },
      summary: 'Staff: edit a BTS point or hide/show it (active); there is no delete',
    },
  },
});

/** Staff-facing routes (admin panel). Not part of the Mini App's client table (`./client`). */
const adminBroadcasts = c.router({
  broadcasts: {
    list: {
      method: 'GET',
      path: '/admin/broadcasts',
      responses: {
        200: z.array(broadcastSchema),
        401: broadcastErrorSchema,
        403: broadcastErrorSchema,
      },
      summary: 'Past broadcasts, newest first, with live counts (owner only)',
    },
    audience: {
      method: 'GET',
      path: '/admin/broadcasts/audience',
      query: audienceQuerySchema,
      responses: {
        200: audienceCountSchema,
        401: broadcastErrorSchema,
        403: broadcastErrorSchema,
      },
      summary: 'Live recipient count for an audience (owner only)',
    },
    get: {
      method: 'GET',
      path: '/admin/broadcasts/:id',
      pathParams: z.object({ id: z.coerce.number().int().positive() }),
      responses: {
        200: broadcastSchema,
        401: broadcastErrorSchema,
        403: broadcastErrorSchema,
        404: broadcastErrorSchema,
      },
      summary: 'One broadcast with its counts; the page polls it while it sends (owner only)',
    },
    create: {
      method: 'POST',
      path: '/admin/broadcasts',
      body: broadcastBodySchema,
      responses: {
        201: broadcastSchema,
        401: broadcastErrorSchema,
        403: broadcastErrorSchema,
        422: broadcastErrorSchema,
      },
      summary: 'Send a broadcast: one durable row, one queued job per customer (owner only)',
    },
    test: {
      method: 'POST',
      path: '/admin/broadcasts/test',
      body: broadcastBodySchema,
      responses: {
        200: testSendResultSchema,
        401: broadcastErrorSchema,
        403: broadcastErrorSchema,
        422: broadcastErrorSchema,
        502: broadcastErrorSchema,
      },
      summary: "«Отправить себе»: both language versions to the owner's own Telegram id",
    },
  },
});

export const adminContract = c.router({ ...adminCore, ...adminDelivery, ...adminBroadcasts });

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
