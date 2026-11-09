type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };

/**
 * One namespace of messages. `ru` is the reference; `uz` must have exactly the same keys,
 * so a key missing (or extra) in either language fails typecheck.
 */
export function defineMessages<R extends object>(ru: R, uz: DeepString<R>) {
  return { ru: ru as DeepString<R>, uz };
}
