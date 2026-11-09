/**
 * Standalone host for the BTS point picker (checkout embeds it later). DEV ONLY, like the
 * component gallery: the route exists only under `import.meta.env.DEV`.
 */
import { useState } from 'react';
import { DeliveryPicker } from '../delivery/DeliveryPicker';
import type { Picked } from '../delivery/queries';
import { usePrefs } from '../lib/prefs';
import { Card } from '../ui/Card';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Sheet } from '../ui/Sheet';

export function DeliveryDev() {
  const { t } = usePrefs();
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<Picked | null>(null);
  return (
    <Screen>
      <ScreenHeader title={t.delivery.pointTitle} />
      <Card className="p-4" data-testid="picked">
        {picked?.kind === 'point'
          ? `${picked.point.name} · ${picked.point.address}`
          : picked?.kind === 'typed'
            ? `typed: ${picked.text}`
            : '-'}
      </Card>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t.delivery.pointTitle}
        description={t.delivery.pointText}
        closeLabel={t.common.close}
      >
        <DeliveryPicker
          mode="point"
          selectedPointId={picked?.kind === 'point' ? picked.point.id : undefined}
          onPick={(p) => {
            setPicked(p);
            setOpen(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}
