import { QueryClient } from '@tanstack/react-query';
import { watchStaleChoice } from '../cart/stale-choice';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

// from launch: the first cart answer (the tab bar's) may be the one reporting a stale choice (#39)
watchStaleChoice(queryClient);
