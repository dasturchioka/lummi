import type { OrderLineDto } from '@lummi/contracts';
import { fill } from '@lummi/i18n';
import { usePrefs } from '../lib/prefs';
import { attribution } from '../ui/FragranceListCard';
import { Money } from '../ui/Money';
import { SetFragranceList } from '../ui/SetFragranceList';
import { Thumb } from '../ui/Thumb';
import { useOrdersText } from './queries';

/** What a line row shows: an order line as bought, or the buy-now item priced by its quote. */
export type OrderLineView = Pick<
  OrderLineDto,
  'kind' | 'brand' | 'name' | 'setComposition' | 'photo' | 'ml' | 'qty' | 'lineTotal' | 'markedDown'
>;

/**
 * A line as bought (DESIGN.md compact row): thumbnail, «по мотивам» and the italic name over the
 * full width, then a receipt row: volume × qty, and the line total at its end. With no stepper on
 * an order, the price waits on that row instead of squeezing the attribution beside it; a marked-down
 * line's total is Sage Ink. The «Купить сейчас» checkout shows its one item through it too.
 */
export function OrderLine({ line }: { line: OrderLineView }) {
  const { t, language } = usePrefs();
  const o = useOrdersText();
  return (
    <li className="flex gap-3 p-3" data-testid="order-line">
      {/* top-aligned: a set's five names make the row taller than its thumbnail */}
      <Thumb
        photo={line.photo}
        className="w-12 self-start"
        set={line.kind === 'volume' ? undefined : line.kind}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {line.brand ? (
          <p className="type-label text-pretty text-muted [overflow-wrap:anywhere]">
            {attribution(t.card.basedOn, line.brand)}
          </p>
        ) : line.kind !== 'volume' ? (
          // a set is labelled as the brand names a set: «НАБОР» over its name
          <p className="type-label text-muted">{t.home.discoveryLabel}</p>
        ) : null}
        <p className="type-name mt-px text-[18px] text-pretty text-ink [overflow-wrap:anywhere]">
          {line.name[language]}
        </p>
        {line.setComposition ? <SetFragranceList items={line.setComposition} /> : null}
        <div className="mt-auto flex items-baseline justify-between gap-3 pt-1">
          <p className="type-small min-w-0 text-muted">
            {line.kind !== 'volume'
              ? `${o.orders.setOf} · ${fill(o.orders.units, { qty: String(line.qty) })}`
              : fill(o.orders.qty, { ml: String(line.ml), qty: String(line.qty) })}
          </p>
          <Money
            amount={line.lineTotal}
            className={`shrink-0 ${line.markedDown ? 'text-sage-ink' : ''}`}
          />
        </div>
      </div>
    </li>
  );
}
