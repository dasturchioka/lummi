import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { session } from '../lib/api';
import { PrefsProvider, usePrefs } from '../lib/prefs';
import { EmptyState, ErrorState } from '../ui/States';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

function Gate() {
  const { t } = usePrefs();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [, retry] = useState(0);

  // Stale initData: nothing to retry. A calm instruction instead of a broken app.
  if (state === 'reopen') {
    return <EmptyState title={t.errors.reopenTitle} text={t.errors.reopenText} />;
  }
  if (state === 'failed') {
    return (
      <ErrorState
        onRetry={() => {
          void session.start().catch(() => undefined);
          retry((n) => n + 1);
        }}
      />
    );
  }
  return <RouterProvider router={router} />;
}

export function App() {
  useEffect(() => session.attach(document), []);
  return (
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <Gate />
      </PrefsProvider>
    </QueryClientProvider>
  );
}
