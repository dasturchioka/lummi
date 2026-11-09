import { usePrefs } from '../lib/prefs';
import { Screen, ScreenHeader } from '../ui/ScreenHeader';
import { EmptyState } from '../ui/States';
import type { TabId } from '../ui/TabBar';

/** The empty screen behind a tab until its own ticket builds it. */
export function Placeholder({ tab }: { tab: Exclude<TabId, 'home' | 'profile'> }) {
  const { t } = usePrefs();
  return (
    <Screen>
      <ScreenHeader title={t.tabs[tab]} />
      <EmptyState title={t.placeholder.emptyTitle} text={t.placeholder.emptyText} />
    </Screen>
  );
}
