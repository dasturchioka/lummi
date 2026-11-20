import type { QueryClientConfig } from '@tanstack/react-query';

/** The app's query defaults; tests build their client from the same ones. */
export const queryDefaults: QueryClientConfig = {
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
};
