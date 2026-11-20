import type { CartDto } from '@lummi/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const chooseDiscount = vi.fn();
vi.mock('../lib/api', () => ({
  api: { cart: { chooseDiscount: (req: unknown) => chooseDiscount(req) } },
  unwrap: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }));

import { CART_FIXTURES } from '../dev/CartFixtures';
import { useChooseDiscount } from './choose';
import { CART_KEY } from './queries';

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => useChooseDiscount(), { wrapper }) };
}

/** #39: the switch's tap; the server judges it against the cart's own quote. */
describe('the discount switch’s tap', () => {
  it('a taken choice comes back with the cart', async () => {
    const cart: CartDto = CART_FIXTURES['choice-coupon'];
    chooseDiscount.mockResolvedValue({ status: 200, body: cart });
    const { qc, result } = setup();
    let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ type: 'birthday_coupon', id: 5 });
    });
    expect(out).toEqual({ cart, refused: false });
    expect(qc.getQueryData(CART_KEY)).toBe(cart);
  });

  it('a refused one (409) says so, and the cart as it is replaces the shown one', async () => {
    const cart: CartDto = CART_FIXTURES['choice-auto'];
    chooseDiscount.mockResolvedValue({
      status: 409,
      body: { code: 'discount_unavailable', cart },
    });
    const { qc, result } = setup();
    let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ type: 'birthday_coupon', id: 5 });
    });
    expect(out).toEqual({ cart, refused: true });
    expect(qc.getQueryData(CART_KEY)).toBe(cart);
  });
});
