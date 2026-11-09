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
  customerSchema,
  preferencesBodySchema,
  sessionSchema,
  telegramAuthBodySchema,
} from './auth';

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
export const adminContract = c.router({ ...adminCore, ...adminDelivery });

/** Both routers under one client, for tests that drive the whole API. */
export const apiContract = c.router({ ...contract, admin: adminContract });
