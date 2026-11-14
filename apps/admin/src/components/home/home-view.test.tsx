// @vitest-environment jsdom
import type { AdminHome } from '@lummi/contracts';
import { adminMessages } from '@lummi/i18n/admin';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The Home's loading (#48): the first answer reaches the screen even when the view mounts twice
 * (React's StrictMode does so in development, and a quick navigation away and back does in
 * production): the first view's request is aborted, the second one's must still go out.
 */

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
const home = vi.fn();
vi.mock('@/lib/api', () => ({ browserApi: { home: (args: unknown) => home(args) } }));

const { HomeView } = await import('./home-view');

const empty = { count: 0, since: null, waitedSeconds: null };
const ANSWER: AdminHome = {
  role: 'manager',
  at: { day: '2026-11-14', time: '10:00' },
  cardMissing: false,
  now: { kind: 'clear' },
  queues: {
    receipts: empty,
    accept: empty,
    assemble: empty,
    bts: empty,
    credits: { ...empty, oldestAmountTiyin: null },
    refunds: empty,
    stock: { count: 0, out: 0, low: 0, first: null },
    reviews: empty,
  },
};

/** The API as a browser sees it: an aborted request rejects, as fetch does. */
function answerAfterTick() {
  home.mockImplementation(
    ({ fetchOptions }: { fetchOptions: { signal: AbortSignal } }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ status: 200, body: ANSWER }), 5);
        fetchOptions.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      }),
  );
}

const ru = adminMessages.ru.admin;
const view = (
  <HomeView
    copy={ru.home}
    title={ru.nav.home}
    retry={ru.actions.retry}
    language="ru"
    role="manager"
    today="2026-11-14"
  />
);

beforeEach(() => {
  home.mockReset();
  replace.mockReset();
});
afterEach(cleanup);

describe('HomeView', () => {
  it('shows the first answer when it mounts twice (StrictMode)', async () => {
    answerAfterTick();
    render(<StrictMode>{view}</StrictMode>);
    // the first view's request is aborted; the second view's still goes out and lands
    expect(await screen.findByText(ru.home.now.clear.title, {}, { timeout: 1000 })).toBeTruthy();
  });

  it('changes nothing after it is gone: no state, no redirect', async () => {
    home.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 401, body: {} }), 5)),
    );
    const { unmount } = render(view);
    unmount();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(replace).not.toHaveBeenCalled();
  });
});
