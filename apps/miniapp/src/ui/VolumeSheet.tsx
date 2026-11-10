import type { FragranceListItem, VolumeCard } from '@lummi/contracts';
import { useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from './Button';
import { Money } from './Money';
import { NameLockup } from './NameLockup';
import { Sheet } from './Sheet';
import { AlertIcon } from './icons';
import { Thumb } from './Thumb';
import { VolumeStatus, VolumeTiles } from './VolumeTiles';

/**
 * The list «+» with several volumes available asks which one (ticket #25): the fragrance as a
 * compact row, the card's own 10 / 30 / 50 ml tiles (mockup 03, price under each; a sold-out one
 * marked and not choosable; a markdown struck, with its row under the tiles as on the card), and
 * «В корзину · <price>» for the chosen one. It opens on the cheapest available, the card's «от …».
 * An add that fails says so here, above the button, where the shopper is looking (the shell's note
 * would sit under the dim). Loaded lazily, on the first press.
 */
export function VolumeSheet({
  item,
  open,
  onOpenChange,
  adding,
  error,
  onAdd,
}: {
  item: FragranceListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adding: boolean;
  /** Why the last add failed, until the next one. */
  error: string | null;
  onAdd: (ml: VolumeCard['ml']) => void;
}) {
  const { t } = usePrefs();
  const cheapest = item.volumes
    .filter((v) => v.available > 0)
    .reduce<VolumeCard | undefined>(
      (best, v) => (!best || v.effectivePrice < best.effectivePrice ? v : best),
      undefined,
    );
  const [ml, setMl] = useState(cheapest?.ml);
  const volume = item.volumes.find((v) => v.ml === ml);
  const canBuy = !!volume && volume.available > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.list.chooseVolume}
      closeLabel={t.common.close}
    >
      <div className="flex flex-col gap-4 pb-1" data-testid="volume-sheet">
        <div className="flex items-center gap-3">
          <Thumb photo={volume?.photo ?? item.photo} className="w-12" />
          <div className="min-w-0 flex-1">
            <NameLockup brand={item.brand} name={item.name} />
          </div>
        </div>
        {ml !== undefined ? (
          <div className="flex flex-col gap-3">
            <VolumeTiles
              volumes={item.volumes}
              selected={ml}
              onSelect={setMl}
              soldOutChoosable={false}
            />
            {volume ? <VolumeStatus volume={volume} stock={false} /> : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="type-small -mb-1 flex items-start gap-2 text-ink">
            <span className="mt-px shrink-0">
              <AlertIcon size={16} />
            </span>
            {error}
          </p>
        ) : null}
        <Button
          block
          loading={adding}
          disabled={!canBuy}
          onClick={() => volume && onAdd(volume.ml)}
          data-availability={canBuy ? undefined : 'sold-out'}
        >
          {canBuy ? (
            <span className="flex items-center gap-1.5">
              {t.card.toCart}
              <span aria-hidden="true" className="opacity-60">
                ·
              </span>
              <Money amount={volume.effectivePrice} />
            </span>
          ) : (
            t.card.unavailable
          )}
        </Button>
      </div>
    </Sheet>
  );
}
