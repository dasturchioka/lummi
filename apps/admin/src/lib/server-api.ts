import { contract } from '@lummi/contracts';
import { initClient } from '@ts-rest/core';
import { cookies } from 'next/headers';

/** Server-component client: forwards the visitor's cookie. Reads only; writes go from the browser. */
export async function serverApi() {
  const cookie = (await cookies()).toString();
  return initClient(contract, {
    baseUrl: process.env.API_URL ?? 'http://127.0.0.1:4000',
    baseHeaders: { cookie },
    throwOnUnknownStatus: false,
  });
}
