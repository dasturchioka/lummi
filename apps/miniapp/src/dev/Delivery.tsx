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
      {/* Tapping the choice reopens the picker on it, as checkout's «Сменить» will. */}
      <button
        type="button"
        data-testid="picked"
        onClick={() => setOpen(true)}
        className="block w-full text-left"
      >
        <Card className="type-body p-4">
          {picked?.kind === 'point'
            ? `${picked.point.name} · ${picked.point.address}`
            : picked?.kind === 'typed'
              ? `typed: ${picked.text}`
              : '-'}
        </Card>
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t.delivery.pointTitle}
        description={t.delivery.pointText}
        closeLabel={t.common.close}
        tall
      >
        <DeliveryPicker
          mode="point"
          initial={
            picked?.kind === 'point'
              ? { regionId: picked.region.id, city: picked.point.city }
              : null
          }
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
