import { useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { Sheet } from '../ui/Sheet';
import { DeliveryPicker } from './DeliveryPicker';
import { useDeliveryCity, useSaveDeliveryCity } from './queries';

/** Home's delivery city in a sheet: region, then city. Saving it never touches a price. Lazy: Radix stays off the entry path. */
export default function DeliverySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = usePrefs();
  const current = useDeliveryCity();
  const save = useSaveDeliveryCity();
  const [failed, setFailed] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailed(false);
        onOpenChange(next);
      }}
      title={t.delivery.cityTitle}
      description={t.delivery.cityText}
      closeLabel={t.common.close}
    >
      <DeliveryPicker
        mode="city"
        initial={
          current.data ? { regionId: current.data.region.id, city: current.data.city } : null
        }
        busy={save.isPending}
        error={failed ? t.delivery.saveFailed : null}
        onPick={(p) => {
          if (p.kind !== 'city') return;
          setFailed(false);
          save.mutate(
            { regionId: p.region.id, city: p.city },
            { onSuccess: () => onOpenChange(false), onError: () => setFailed(true) },
          );
        }}
      />
    </Sheet>
  );
}
