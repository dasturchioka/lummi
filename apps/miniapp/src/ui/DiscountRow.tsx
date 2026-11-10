import type { Discount } from '@lummi/contracts';
import { Fragment, type ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Figure } from './Figure';

type T = ReturnType<typeof usePrefs>['t'];

/**
 * A promo code that wraps only at its joints («BLOGER_MALIKA_|NOVOGODNIY_|…»), never mid-word
 * unless one part alone is wider than the line. The break points are `<wbr>`, not characters, so
 * a copied code pastes back as it was.
 */
export function CodeText({ code }: { code: string }) {
  return code.split(/(?<=[_-])/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}

/** Where the one discount comes from: «Промокод BLOGER10», «Купон на день рождения», a set's right. */
function source(d: Discount, t: T): ReactNode {
  if (d.type === 'promo_code') {
    const [before = '', after = ''] = t.cart.sourcePromo.split('{code}');
    return (
      <>
        {before}
        <CodeText code={d.code} />
        {after}
      </>
    );
  }
  if (d.type === 'birthday_coupon') return t.cart.sourceBirthday;
  return d.source === 'set' ? t.cart.sourceSet : t.cart.sourceSingle;
}

/**
 * The one discount in a dark totals block (the cart's, checkout's and an order's), between the
 * items and the delivery it never touches: «Скидка» and its amount on one line in Dark Sage Ink,
 * its source on the line under them across the whole width, so a 32-character code never
 * squeezes beside a seven-digit amount. A `<dl>` row: one term, the amount, the source.
 */
export function DiscountRow({ discount, testId }: { discount: Discount; testId?: string }) {
  const { t } = usePrefs();
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 text-totals-accent"
      data-testid={testId}
    >
      <dt className="min-w-0">{t.cart.discount}</dt>
      <dd className="type-price">
        <Figure amount={discount.amount} minus />
      </dd>
      <dd className="type-caption col-span-2 [overflow-wrap:anywhere] opacity-80">
        {source(discount, t)}
      </dd>
    </div>
  );
}
