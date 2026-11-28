import { useLayoutEffect, useRef, useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from './Button';
import { Money } from './Money';

/**
 * The buying pair of a dock (approved comp, the fragrance card; the set screens too, #25):
 * «В корзину · <price>» and the tonal «Купить сейчас».
 *
 * The comp's single line needs about 356 px with a seven-digit UZ price; on a narrower phone
 * (360 px Androids, 375 px iPhones) the price steps under «В корзину» instead of being clipped. An
 * invisible copy of the single line measures what it needs, so the choice follows the real text.
 */
export function BuyPair({
  toCart,
  price,
  was,
  adding = false,
  onAdd,
  onBuyNow,
}: {
  /** «В корзину», in the caller's own words. */
  toCart: string;
  price: number;
  /**
   * A higher price struck before it (the fragrance card with an upgrade right, #38). Stacked, it
   * shares the price's line while that fits, else it is left to the tile above.
   */
  was?: number;
  adding?: boolean;
  onAdd: () => void;
  onBuyNow: () => void;
}) {
  const { t } = usePrefs();
  const row = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const stackProbe = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  const [wasFits, setWasFits] = useState(true);
  useLayoutEffect(() => {
    const r = row.current;
    const p = probe.current;
    const sp = stackProbe.current;
    if (!r || !p || !sp || typeof ResizeObserver === 'undefined') return;
    const check = () => {
      setStacked(p.scrollWidth > r.clientWidth);
      setWasFits(sp.scrollWidth <= r.clientWidth);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(r);
    observer.observe(p); // the fonts arriving change what the line needs
    observer.observe(sp);
    return () => observer.disconnect();
  }, []);

  const oneLine = (
    <span className="flex items-center gap-1.5">
      {toCart}
      <span aria-hidden="true" className="opacity-60">
        ·
      </span>
      {was !== undefined ? (
        <s className="opacity-60">
          <Money amount={was} size="small" />
        </s>
      ) : null}
      <Money amount={price} />
    </span>
  );
  const stackedPrice = (
    <span className="flex items-baseline gap-1.5">
      {was !== undefined && wasFits ? (
        <s className="opacity-60">
          <Money amount={was} size="small" />
        </s>
      ) : null}
      <Money amount={price} size="small" className="opacity-80" />
    </span>
  );
  return (
    <div ref={row} className="relative flex gap-2">
      {/* Clipped to the row, so the measuring copy never widens the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none invisible absolute inset-0 overflow-hidden"
      >
        <div ref={probe} className="type-button flex w-max gap-2">
          <span className="px-3.5">{oneLine}</span>
          <span className="px-3.5">{t.card.buyNow}</span>
        </div>
        {/* the stacked price line with the struck price, beside «Купить сейчас» */}
        <div ref={stackProbe} className="type-button flex w-max gap-2">
          <span className="flex items-baseline gap-1.5 px-3.5">
            {was !== undefined ? <Money amount={was} size="small" /> : null}
            <Money amount={price} size="small" />
          </span>
          <span className="px-3.5">{t.card.buyNow}</span>
        </div>
      </div>
      <Button size="pair" className="min-w-0 flex-1" loading={adding} onClick={onAdd}>
        {stacked ? (
          // stacked (a narrow phone), the button keeps to two lines: the struck price shares the
          // price's line while it fits, else it stays on the tile above
          <span className="flex flex-col items-center gap-1">
            {toCart}
            {stackedPrice}
          </span>
        ) : (
          oneLine
        )}
      </Button>
      <Button
        variant="tonal"
        size="pair"
        className="shrink-0"
        data-testid="buy-now"
        onClick={onBuyNow}
      >
        {t.card.buyNow}
      </Button>
    </div>
  );
}
