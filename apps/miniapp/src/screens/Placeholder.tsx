import { usePrefs } from '../lib/prefs';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { EmptyState } from '../ui/States';
import type { TabId } from '../ui/TabBar';

/** The empty screen behind a tab until its own ticket builds it: says what will live here. */
export function Placeholder({ tab }: { tab: Exclude<TabId, 'home' | 'profile'> }) {
  const { t } = usePrefs();
  const copy = t.placeholder[tab];
  return (
    <Screen>
      <ScreenHeader title={t.tabs[tab]} />
      <EmptyState fill title={copy.title} text={copy.text} />
    </Screen>
  );
}
