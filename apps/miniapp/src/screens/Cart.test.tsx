import { sharedMessages, type Language } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { cleanup, render, screen, within } from '@testing-library/react';
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
