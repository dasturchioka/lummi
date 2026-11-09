import type { ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { BagIcon, BoxIcon, GridIcon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { EmptyState } from '../ui/States';
import type { TabId } from '../ui/TabBar';

type PlaceholderTab = Exclude<TabId, 'home' | 'profile'>;

/** The tab's own icon, as in the tab bar, so the empty screen reads as that tab. */
const ICONS: Record<PlaceholderTab, ReactNode> = {
  catalog: <GridIcon size={28} />,
  cart: <BagIcon size={28} />,
  orders: <BoxIcon size={28} />,
};

/** The empty screen behind a tab until its own ticket builds it: says what will live here. */
export function Placeholder({ tab }: { tab: PlaceholderTab }) {
  const { t } = usePrefs();
  const copy = t.placeholder[tab];
  return (
    <Screen>
      <ScreenHeader title={t.tabs[tab]} />
      <EmptyState fill icon={ICONS[tab]} title={copy.title} text={copy.text} />
    </Screen>
  );
}
