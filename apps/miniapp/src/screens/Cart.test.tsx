import { sharedMessages, type Language } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let language: Language = 'ru';
vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language,
    theme: 'light',
    t: { ...sharedMessages[language], ...miniappMessages[language] },
  }),
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }));

import { CART_FIXTURES } from '../dev/CartFixtures';
import { CartView } from './Cart';

afterEach(() => {
  cleanup();
  language = 'ru';
});

describe('CartView: the line an upgrade right discounts (#38)', () => {
  it('is marked «Скидка за набор −20% на один флакон»; the other lines are not', () => {
    render(<CartView cart={CART_FIXTURES.discount} />);
    const [symphony, tygar] = screen.getAllByTestId('cart-line');
    expect(within(symphony!).getByTestId('line-deal').textContent).toBe(
      'Скидка за набор −20% на один флакон',
    );
    expect(within(tygar!).queryByTestId('line-deal')).toBeNull();
  });

  it('in Uzbek', () => {
    language = 'uz';
    render(<CartView cart={CART_FIXTURES.discount} />);
    expect(screen.getByTestId('line-deal').textContent).toBe(
      'Toʻplam chegirmasi −20% bitta flakonga',
    );
  });
});

/** The text as read, every run of spaces (the money's narrow no-break ones too) as one space. */
const read = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rowsOf = () =>
  screen.getAllByRole('radio').map((r) => ({
    label: read(within(r).getByTestId('option-label')),
    detail: read(within(r).queryByTestId('option-detail')),
    delivery: read(within(r).queryByTestId('option-delivery')),
    total: read(within(r).getByTestId('option-total')),
    checked: r.getAttribute('aria-checked') === 'true',
  }));

describe('CartView: the discount switch (#39)', () => {
  it('lists every choice with its total, «Не применять» last, the applied one checked', () => {
    render(<CartView cart={CART_FIXTURES['choice-auto']} />);
    expect(rowsOf()).toEqual([
      {
        label: 'Скидка за набор −20%',
        detail: '−29 800 сум · Tygar 30 мл · до 1 декабря',
        delivery: '',
        total: '257 200 сум',
        checked: true,
      },
      {
        // the bigger discount, yet a higher total: counted after it, delivery comes back
        label: 'Купон ко дню рождения −15%',
        detail: '−43 050 сум · до 21 ноября',
        delivery: '+ доставка 25 000 сум',
        total: '268 950 сум',
        checked: false,
      },
      {
        label: 'Не применять',
        detail: 'Скидка сохранится на следующий заказ',
        delivery: '',
        total: '287 000 сум',
        checked: false,
      },
    ]);
  });

  it('a row says it brings delivery back, the applied one too; none does when all pay it alike', () => {
    const applied = CART_FIXTURES['choice-coupon'];
    render(<CartView cart={applied} />);
    expect(rowsOf().map((r) => [r.delivery, r.checked])).toEqual([
      ['', false],
      ['+ доставка 25 000 сум', true],
      ['', false],
    ]);
    cleanup();

    const auto = CART_FIXTURES['choice-auto'];
    const allPay = auto.discountOptions.map((o) => ({ ...o, deliveryFee: 25_000 }));
    render(<CartView cart={{ ...auto, discountOptions: allPay }} />);
    expect(rowsOf().map((r) => r.delivery)).toEqual(['', '', '']);
    cleanup();

    language = 'uz';
    render(<CartView cart={auto} />);
    expect(rowsOf()[1]!.delivery).toBe('+ 25 000 soʻm yetkazish');
  });

  it('one tap switches: an entitlement, «Не применять», the entered code; the applied one does nothing', () => {
    const onChoose = vi.fn();
    render(<CartView cart={CART_FIXTURES['choice-switched']} onChoose={onChoose} />);
    const [right, coupon, code, none] = screen.getAllByRole('radio');
    fireEvent.click(right!);
    fireEvent.click(coupon!);
    fireEvent.click(code!);
    fireEvent.click(none!);
    expect(onChoose.mock.calls).toEqual([
      [{ type: 'birthday_coupon', id: 5 }],
      [{ type: 'promo_code' }],
      [{ type: 'none' }],
    ]);
    expect(read(within(code!).getByTestId('option-label'))).toBe('Промокод BLOGER5');
    // the code stays in its field, muted: not applied
    expect(read(screen.getByTestId('promo-status'))).toBe('Сейчас выбрана другая скидка');
    expect(screen.getByTestId('promo-input').getAttribute('data-state')).toBe('off');
  });

  it('an applied code reads as applied in its field', () => {
    render(<CartView cart={CART_FIXTURES['choice-promo']} />);
    expect(screen.getByTestId('promo-input').hasAttribute('data-state')).toBe(false);
  });

  it('with an entered code, a cheaper entitlement says by how much, and «Переключить» picks it', () => {
    const onChoose = vi.fn();
    render(<CartView cart={CART_FIXTURES['choice-promo']} onChoose={onChoose} />);
    const better = screen.getByTestId('choice-better');
    expect(read(within(better).getByTestId('better-text'))).toBe(
      'Скидка за набор выгоднее на 15 450 сум',
    );
    expect(read(within(better).getByTestId('better-detail'))).toBe('Tygar 30 мл · до 1 декабря');
    fireEvent.click(within(better).getByRole('button', { name: 'Переключить' }));
    expect(onChoose.mock.calls).toEqual([[{ type: 'upgrade_right', id: 1 }]]);
  });

  it('the hint is worded by source: a 10 ml bottle’s right, the birthday coupon', () => {
    const promo = CART_FIXTURES['choice-promo'];
    const waiting = promo.entitlementWaiting;
    if (waiting?.type !== 'upgrade_right') throw new Error('the fixture waits with a set right');
    render(
      <CartView cart={{ ...promo, entitlementWaiting: { ...waiting, source: 'single_10ml' } }} />,
    );
    expect(read(screen.getByTestId('better-text'))).toBe('Скидка за 10 мл выгоднее на 15 450 сум');
    cleanup();

    const onChoose = vi.fn();
    render(
      <CartView
        cart={{
          ...promo,
          entitlementWaiting: {
            type: 'birthday_coupon',
            id: 5,
            percent: 15,
            lastDay: '2026-11-21',
            cheaperBy: 3_700,
          },
        }}
        onChoose={onChoose}
      />,
    );
    expect(read(screen.getByTestId('better-text'))).toBe(
      'Купон ко дню рождения выгоднее на 3 700 сум',
    );
    expect(read(screen.getByTestId('better-detail'))).toBe('до 21 ноября');
    fireEvent.click(screen.getByRole('button', { name: 'Переключить' }));
    expect(onChoose.mock.calls).toEqual([[{ type: 'birthday_coupon', id: 5 }]]);
  });

  it('no hint while the entered code is not dearer than the entitlement', () => {
    const promo = CART_FIXTURES['choice-promo'];
    render(
      <CartView
        cart={{ ...promo, entitlementWaiting: { ...promo.entitlementWaiting!, cheaperBy: 0 } }}
      />,
    );
    expect(screen.getByTestId('discount-choice')).toBeTruthy();
    expect(screen.queryByTestId('choice-better')).toBeNull();
  });

  it('in Uzbek', () => {
    language = 'uz';
    render(<CartView cart={CART_FIXTURES['choice-promo']} />);
    expect(read(screen.getByTestId('better-text'))).toBe(
      'Toʻplam chegirmasi 15 450 soʻm foydaliroq',
    );
    expect(rowsOf().at(-1)).toMatchObject({ label: 'Qoʻllamaslik', total: '287 000 soʻm' });
  });

  it('«Не применять» applied: no discount, the code field says no discount applies', () => {
    render(<CartView cart={CART_FIXTURES['choice-none']} />);
    expect(rowsOf().map((r) => r.checked)).toEqual([false, false, true]);
    expect(screen.queryByTestId('discount-row')).toBeNull();
  });

  it('a chosen discount that went stale says which, and what applies now', () => {
    render(<CartView cart={CART_FIXTURES['choice-stale']} />);
    expect(read(screen.getByTestId('choice-stale'))).toBe(
      'Купон ко дню рождения больше не действует — применили скидку за набор.',
    );
    cleanup();

    // nothing left to apply: the notice stands alone
    render(
      <CartView
        cart={CART_FIXTURES.plain}
        lapsed={{ what: { type: 'upgrade_right', source: 'set' } }}
      />,
    );
    expect(screen.queryByTestId('discount-choice')).toBeNull();
    expect(read(screen.getByTestId('choice-stale'))).toBe(
      'Скидка за набор больше не действует — сейчас скидки нет.',
    );
    cleanup();

    language = 'uz';
    render(<CartView cart={CART_FIXTURES['choice-stale']} />);
    expect(read(screen.getByTestId('choice-stale'))).toBe(
      'Tugʻilgan kun kuponi endi amal qilmaydi — toʻplam chegirmasi qoʻllandi.',
    );
  });

  it('a refused tap says the same: the code it named, or an unnamed discount', () => {
    const auto = CART_FIXTURES['choice-auto'];
    render(<CartView cart={auto} lapsed={{ what: { type: 'promo_code', code: 'BLOGER5' } }} />);
    expect(read(screen.getByTestId('choice-stale'))).toBe(
      'Промокод BLOGER5 больше не действует — применили скидку за набор.',
    );
    cleanup();
    render(<CartView cart={CART_FIXTURES['choice-none']} lapsed={{ what: null }} />);
    expect(read(screen.getByTestId('choice-stale'))).toBe(
      'Выбранная скидка больше не действует — сейчас скидки нет.',
    );
  });

  it('is not shown when there is nothing to choose between', () => {
    render(<CartView cart={CART_FIXTURES.discount} />);
    expect(screen.queryByTestId('discount-choice')).toBeNull();
    cleanup();
    render(<CartView cart={CART_FIXTURES['promo-applied']} />);
    expect(screen.queryByTestId('discount-choice')).toBeNull();
  });
});

describe('CartView: a gift code’s gift (ADR 0039)', () => {
  it.each([
    [
      'ru',
      'Подарок по промокоду',
      '0 сум',
      'Промокод применён: подарок в заказе',
      'Промокод RAINTEA',
    ],
    [
      'uz',
      'Promokod sovgʻasi',
      '0 soʻm',
      'Promokod qoʻllandi: sovgʻa buyurtmada',
      'Promokod RAINTEA',
    ],
  ] as const)(
    'lists it under the lines at 0, with no stepper (%s)',
    (lang, label, zero, applied, source) => {
      language = lang;
      render(<CartView cart={CART_FIXTURES['promo-gift']} />);
      const gift = screen.getByTestId('promo-gift-line');
      expect(read(gift)).toContain('Rain Tea');
      expect(read(gift)).toContain(label);
      expect(read(gift)).toContain(zero);
      expect(within(gift).queryByRole('button')).toBeNull();
      // it is not a cart line: the paid lines are what they were
      expect(screen.getAllByTestId('cart-line')).toHaveLength(CART_FIXTURES.plain.lines.length);
      // the totals: nothing off the items, the gift's row at 0 under its code
      const bare = (x: string) => x.replace(/\s/g, '');
      expect(bare(read(screen.getByTestId('discount-row')))).toBe(bare(`${label}${zero}${source}`));
      expect(read(screen.getByTestId('totals'))).not.toContain('−');
      expect(screen.getByText(applied)).not.toBeNull();
    },
  );

  it('the Discovery set as the gift names its five', () => {
    render(<CartView cart={CART_FIXTURES['promo-gift-set']} />);
    const gift = screen.getByTestId('promo-gift-line');
    expect(read(gift)).toContain('Discovery set');
    expect(read(gift)).toContain('Megamare');
  });

  it.each([
    ['ru', 'Подарок закончился.', 'Заказ можно оформить и без него.'],
    ['uz', 'Sovgʻa tugadi.', 'Buyurtmani usiz ham rasmiylashtirish mumkin.'],
  ] as const)('a gift that ran out says so and lists no gift (%s)', (lang, reason, next) => {
    language = lang;
    render(<CartView cart={CART_FIXTURES['promo-gift-sold-out']} />);
    expect(screen.queryByTestId('promo-gift-line')).toBeNull();
    expect(screen.getByText(reason)).not.toBeNull();
    expect(screen.getByText(next)).not.toBeNull();
  });
});
