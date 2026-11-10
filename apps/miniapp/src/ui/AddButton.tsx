import type { CartDto, FragranceListItem, VolumeCard } from '@lummi/contracts';
import { fill } from '@lummi/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { addNote, lineQty } from '../cart/add-note';
import { CART_KEY, useAddToCart } from '../cart/queries';
import { usePrefs } from '../lib/prefs';
import { hapticSuccess } from '../lib/telegram';
import { CheckIcon, PlusIcon, Spinner } from './icons';
import { showShopNote } from './ShopNoteHost';

export { ShopNote } from './ShopNote';

// The volume choice is the only heavy part of «+»: it loads on the first press (ticket #25 budget).
const loadSheet = () => import('./VolumeSheet');
const VolumeSheet = lazy(async () => ({ default: (await loadSheet()).VolumeSheet }));

/**
 * The list card's «+» (TZ §3.2, DESIGN.md "Add +"): a 32 px Graphite square on the photo's
 * bottom-right corner, never on the price line, so a seven-digit price keeps its full size on a
 * 360 px phone (#15, #16 reviews). With one volume available it adds that one; with several it
 * asks which in a sheet (the card's volume tiles). Feedback is the card dock's: a haptic, the
 * tab-bar count and «Добавлено в корзину» / «Осталось N» / «Не больше 99 шт.». Nothing to buy,
 * no «+».
 */
export function AddButton({ item }: { item: FragranceListItem }) {
  const inStock = item.volumes.filter((v) => v.available > 0);
  return inStock.length > 0 ? <Add item={item} inStock={inStock} /> : null;
}

function Add({ item, inStock }: { item: FragranceListItem; inStock: VolumeCard[] }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const add = useAddToCart();
  const [sheet, setSheet] = useState<'closed' | 'open' | 'unmounted'>('unmounted');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(id);
  }, [done]);

  const addVolume = (ml: VolumeCard['ml']) => {
    const before = lineQty(qc.getQueryData<CartDto>(CART_KEY), item.slug, ml);
    add.mutate(
      { slug: item.slug, ml },
      {
        onSuccess: (next) => {
          const said = addNote(t, before, next, item.slug, ml);
          if (said.added) {
            hapticSuccess();
            setDone(true);
          }
          setSheet((s) => (s === 'open' ? 'closed' : s));
          showShopNote(said.text);
        },
        onError: (e) => {
          // stock moved under the list: say so and let the cards re-read what is true now
          showShopNote(e.message === 'HTTP 409' ? t.cart.soldOut : t.cart.addFailed);
          void qc.invalidateQueries({ queryKey: ['catalog'] });
          void qc.invalidateQueries({ queryKey: ['search'] });
        },
      },
    );
  };

  return (
    <>
      <button
        type="button"
        aria-label={fill(t.cart.addSuggestion, { name: item.name })}
        aria-haspopup={inStock.length > 1 ? 'dialog' : undefined}
        data-testid="list-add"
        disabled={add.isPending}
        onPointerDown={inStock.length > 1 ? () => void loadSheet() : undefined}
        onClick={() => (inStock.length > 1 ? setSheet('open') : addVolume(inStock[0]!.ml))}
        className="absolute right-1.5 bottom-1.5 z-10 grid size-8 place-items-center rounded-btn bg-btn text-btn-ink transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] after:absolute after:-inset-1.5 active:scale-95 disabled:opacity-100"
      >
        {add.isPending && sheet !== 'open' ? (
          <Spinner size={16} />
        ) : done ? (
          <CheckIcon size={18} />
        ) : (
          <PlusIcon size={18} />
        )}
      </button>
      {sheet !== 'unmounted' ? (
        <Suspense fallback={null}>
          <VolumeSheet
            item={item}
            open={sheet === 'open'}
            onOpenChange={(open) => setSheet(open ? 'open' : 'closed')}
            adding={add.isPending}
            onAdd={addVolume}
          />
        </Suspense>
      ) : null}
    </>
  );
}
