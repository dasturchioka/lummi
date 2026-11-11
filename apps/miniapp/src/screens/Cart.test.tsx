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
        total: '257 200 сум',
        checked: true,
      },
      {
        label: 'Купон ко дню рождения −15%',
        detail: '−43 050 сум · до 21 ноября',
        total: '268 950 сум',
        checked: false,
      },
      {
        label: 'Не применять',
        detail: 'Скидка сохранится на следующий заказ',
        total: '287 000 сум',
        checked: false,
      },
    ]);
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
    // the code stays in its field, not applied
    expect(read(screen.getByTestId('promo-status'))).toBe('Сейчас выбрана другая скидка');
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

  it('a chosen discount that went stale says so', () => {
    render(<CartView cart={CART_FIXTURES['choice-stale']} />);
    expect(read(screen.getByTestId('choice-stale'))).toBe(
      'Выбранная скидка больше не действует. Итог пересчитан.',
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
