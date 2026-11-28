import { clientContract } from '@lummi/contracts/client';
import type { InitClientReturn } from '@ts-rest/core';

/**
 * A tiny typed client for the Mini App. `@ts-rest/core` imports zod at runtime (~15 KB gzip),
 * so only its TYPES are used here: calls are typed by `typeof contract` exactly as with
 * `initClient`, and this file does the fetching (JSON, path params, query string).
 */
export interface RequestInput {
  body?: unknown;
  params?: Record<string, string | number>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  extraHeaders?: Record<string, string | undefined>;
}
export interface Sender {
  (req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
  }): Promise<Response>;
}

type Routes = typeof clientContract;
export type Client = InitClientReturn<
  Routes,
  { baseUrl: string; baseHeaders: Record<string, string> }
>;

export function buildUrl(
  baseUrl: string,
  path: string,
  params?: RequestInput['params'],
  query?: RequestInput['query'],
): string {
  const filled = path.replace(/:(\w+)/g, (_m, key: string) => {
    const v = params?.[key];
    if (v === undefined) throw new Error(`missing path param "${key}" for ${path}`);
    return encodeURIComponent(String(v));
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue;
    for (const item of Array.isArray(v) ? v : [v]) qs.append(k, String(item));
  }
  const tail = qs.size ? `?${qs}` : '';
  return `${baseUrl}${filled}${tail}`;
}

async function parse(res: Response) {
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body, headers: res.headers };
}

export function createClient(baseUrl: string, send: Sender = (r) => fetch(r.url, r)): Client {
  const build = (node: object): object =>
    Object.fromEntries(
      Object.entries(node).map(([key, value]) => {
        if (value && typeof value === 'object' && 'method' in value && 'path' in value) {
          const route = value as { method: string; path: string };
          return [
            key,
            async (input: RequestInput = {}) => {
              const headers: Record<string, string> = {};
              for (const [h, v] of Object.entries({ ...input.extraHeaders, ...input.headers })) {
                if (v !== undefined) headers[h] = v;
              }
              let body: string | undefined;
              if (input.body !== undefined) {
                body = JSON.stringify(input.body);
                headers['content-type'] = 'application/json';
              }
              return parse(
                await send({
                  url: buildUrl(baseUrl, route.path, input.params, input.query),
                  method: route.method,
                  headers,
                  body,
                }),
              );
            },
          ];
        }
        return [key, build(value as object)];
      }),
    );
  return build(clientContract) as Client;
}
