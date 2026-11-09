/**
 * Standalone host for the BTS point picker (checkout embeds it later). DEV ONLY, like the
 * component gallery: the route exists only under `import.meta.env.DEV`.
 */
import { useState } from 'react';
import { ChosenPoint } from '../delivery/ChosenPoint';
import { DeliveryPicker } from '../delivery/DeliveryPicker';
import { useCities, type Picked } from '../delivery/queries';
import { usePrefs } from '../lib/prefs';
import { Card } from '../ui/Card';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Sheet } from '../ui/Sheet';

export function DeliveryDev() {
  const { t } = usePrefs();
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<Picked | null>(null);
  const point = picked?.kind === 'point' ? picked.point : null;
  // the city list the picker already loaded holds the count for «ещё N пунктов»
  const cities = useCities(point?.regionId);
  const inCity = cities.data?.find((c) => c.city === point?.city)?.pointCount ?? 0;
  return (
    <Screen>
      <ScreenHeader title={t.delivery.pointTitle} />
      {point ? (
        <ChosenPoint
          point={point}
          otherPoints={Math.max(0, inCity - 1)}
          onChange={() => setOpen(true)}
        />
      ) : (
        <button
          type="button"
          data-testid="picked"
          onClick={() => setOpen(true)}
          className="block w-full text-left"
        >
          <Card className="type-body p-4">
            {picked?.kind === 'typed' ? `typed: ${picked.text}` : '-'}
          </Card>
        </button>
      )}
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
          selectedPointId={point?.id}
          onPick={(p) => {
            setPicked(p);
            setOpen(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}
