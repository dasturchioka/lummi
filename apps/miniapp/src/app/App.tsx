import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useSyncExternalStore } from 'react';
import { session } from '../lib/api';
import { PrefsProvider, usePrefs } from '../lib/prefs';
import { closeApp } from '../lib/telegram';
import { Button } from '../ui/Button';
import { Monogram } from '../ui/Logo';
import { Screen } from '../ui/Screen';
import { EmptyState, ErrorState } from '../ui/States';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

function Gate() {
  const { t } = usePrefs();
  const state = useSyncExternalStore(session.subscribe, session.getState);

  // Stale initData: nothing to retry. A calm instruction instead of a broken app.
  if (state === 'reopen') {
    return (
      <Screen tabBar={false}>
        <EmptyState
          fill
          icon={<Monogram size={38} />}
          title={t.session.reopenTitle}
          text={t.session.reopenText}
          action={
            <Button block onClick={closeApp}>
              {t.common.close}
            </Button>
          }
        />
      </Screen>
    );
  }
  if (state === 'failed') {
    return (
      <Screen tabBar={false}>
        <ErrorState
          fill
          onRetry={() => {
            void session.start().catch(() => undefined);
          }}
        />
      </Screen>
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
