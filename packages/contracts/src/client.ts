import type { contract } from './contract';

/**
 * The Mini App's view of the API contract, WITHOUT zod at runtime.
 *
 * The server contract (`./contract`) carries zod schemas, which would add ~15 KB gzip to the
 * Mini App's initial JS. The ts-rest client needs only each route's method, path and response
 * statuses at runtime, so this file lists exactly those, and every type (bodies, responses,
 * params) still comes from `typeof contract`. When the server contract changes, a route added,
 * moved or given another status fails typecheck here (`ClientMatchesServer`) and in
 * `client.test.ts`, so there is no second place to keep in sync by hand beyond this table.
 */
function route<M extends string, P extends string, S extends number>(
  method: M,
  path: P,
  statuses: readonly S[],
) {
  const responses = Object.fromEntries(statuses.map((s) => [s, undefined])) as {
    [K in S]: undefined;
  };
  return { method, path, responses };
}

export const clientRoutes = {
  auth: {
    telegram: route('POST', '/auth/telegram', [200, 401]),
    refresh: route('POST', '/auth/refresh', [200, 401]),
  },
  me: {
    get: route('GET', '/me', [200, 401]),
    updatePreferences: route('PATCH', '/me/preferences', [200, 401]),
  },
  catalog: {
    fragrance: route('GET', '/catalog/fragrances/:slug', [200, 401, 404]),
  },
};

type Meta<T> = {
  [K in keyof T]: T[K] extends { method: infer M; path: infer P; responses: infer R }
    ? { method: M; path: P; statuses: keyof R }
    : Meta<T[K]>;
};
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** Compile-time check: fails typecheck if the table above drifts from the server contract. */
export type ClientMatchesServer = Assert<Equal<Meta<typeof contract>, Meta<typeof clientRoutes>>>;

/** Typed exactly like the server contract; only the zod runtime is missing. */
export const clientContract = clientRoutes as unknown as typeof contract;
