import type { CartDto } from '@lummi/contracts';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({ api: {}, unwrap: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }));

import { CART_FIXTURES } from '../dev/CartFixtures';
import { CART_KEY } from './queries';
import { useStaleChoice, watchStaleChoice } from './stale-choice';

// cache events go out on the next tick; run them now
notifyManager.setScheduler((cb) => cb());

const stale = CART_FIXTURES['choice-stale'];
const fresh = CART_FIXTURES['choice-auto'];
const empty: CartDto = { ...fresh, lines: [], count: 0, discountOptions: [] };

/**
 * #39: the server reports a stale chosen discount once, in whichever cart answer comes first (the
 * tab bar's read on launch, an add from a fragrance card, the cart screen's own), so the Mini App
 * keeps it from any of them until the shopper picks a discount or the cart empties.
 */
describe('the stale-choice notice', () => {
  it('is kept from any cart answer, past later answers that no longer report it, until cleared', () => {
    const qc = new QueryClient();
    const note = watchStaleChoice(qc);
    expect(note.get()).toBeNull();
    qc.setQueryData(CART_KEY, fresh);
    expect(note.get()).toBeNull();
    // the tab bar's read reported it, naming the lapsed coupon; then an add from a fragrance card
    // answered without it
    qc.setQueryData(CART_KEY, stale);
    qc.setQueryData(CART_KEY, fresh);
    expect(note.get()).toEqual({ what: { type: 'birthday_coupon' } });
    // the shopper picked a discount
    note.clear();
    expect(note.get()).toBeNull();
  });

  it('a tap the server refused is reported the same way, naming what was tapped', () => {
    const qc = new QueryClient();
    const note = watchStaleChoice(qc);
    note.report({ type: 'upgrade_right', source: 'single_10ml' });
    expect(note.get()).toEqual({ what: { type: 'upgrade_right', source: 'single_10ml' } });
    note.report(null);
    expect(note.get()).toEqual({ what: null });
  });

  it('a fetched cart counts as much as a written one', async () => {
    const qc = new QueryClient();
    const note = watchStaleChoice(qc);
    await qc.fetchQuery({ queryKey: CART_KEY, queryFn: async () => stale });
    expect(note.get()).not.toBeNull();
  });

  it('an emptied (or ordered) cart forgets it: the choice went with its lines', () => {
    const qc = new QueryClient();
    const note = watchStaleChoice(qc);
    qc.setQueryData(CART_KEY, stale);
    qc.setQueryData(CART_KEY, empty);
    expect(note.get()).toBeNull();
  });

  it('only the cart counts: a checkout or buy-now quote is not the cart’s choice', () => {
    const qc = new QueryClient();
    const note = watchStaleChoice(qc);
    qc.setQueryData(['checkout', 'volume:x:50'], { quote: { staleChoice: true }, lines: [{}] });
    expect(note.get()).toBeNull();
  });

  it('the cart screen reads it for the app’s client and re-renders when it changes', () => {
    const qc = new QueryClient();
    watchStaleChoice(qc);
    qc.setQueryData(CART_KEY, stale);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useStaleChoice(), { wrapper });
    expect(result.current.lapsed).toEqual({ what: { type: 'birthday_coupon' } });
    act(() => result.current.clear());
    expect(result.current.lapsed).toBeNull();
    act(() => void qc.setQueryData(CART_KEY, { ...stale }));
    expect(result.current.lapsed).not.toBeNull();
    act(() => result.current.report({ type: 'promo_code', code: 'BLOGER5' }));
    expect(result.current.lapsed).toEqual({ what: { type: 'promo_code', code: 'BLOGER5' } });
  });
});
