import { lazy, Suspense, useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { ChevronIcon } from '../ui/icons-core';
import { Skeleton } from '../ui/Skeleton';
import { useDeliveryCity } from './queries';

const DeliverySheet = lazy(() => import('./DeliverySheet'));

/**
 * Home's centre slot (approved variant 2): «Доставка» over the city name and a chevron. It opens
 * the region -> city sheet. A place only: it never changes a price.
 */
export function DeliveryRow() {
  const { t } = usePrefs();
  const city = useDeliveryCity();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="delivery-row"
        aria-haspopup="dialog"
        aria-label={`${t.home.delivery}: ${city.data?.city ?? t.home.chooseCity}. ${t.home.changeCity}`}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        className="flex h-11 min-w-0 flex-col items-center justify-center rounded-btn px-3 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
      >
        <span className="type-caption text-muted">{t.home.delivery}</span>
        <span className="mt-0.5 flex max-w-full items-center gap-1">
          {city.isPending ? (
            <Skeleton className="my-0.5 h-4 w-24" />
          ) : (
            <span className="type-row truncate font-semibold">
              {city.data?.city ?? t.home.chooseCity}
            </span>
          )}
          <span className="shrink-0 rotate-90 text-ink">
            <ChevronIcon size={14} />
          </span>
        </span>
      </button>
      {mounted ? (
        <Suspense fallback={null}>
          <DeliverySheet open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
