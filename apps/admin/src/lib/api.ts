import { contract } from '@lummi/contracts';
import { initClient } from '@ts-rest/core';

/** Browser client: same-origin `/api/*` (proxied to the API), so the httpOnly cookie rides along. */
export const browserApi = initClient(contract, {
  baseUrl: '/api',
  baseHeaders: {},
  throwOnUnknownStatus: false,
});
