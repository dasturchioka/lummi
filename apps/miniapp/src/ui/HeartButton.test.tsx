import type { FavouriteIds } from '@lummi/contracts';
import { sharedMessages } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language: 'ru',
    theme: 'light',
    t: { ...sharedMessages.ru, ...miniappMessages.ru },
  }),
}));
const haptic = vi.fn();
vi.mock('../lib/telegram', () => ({ hapticSuccess: () => haptic() }));

const ids = vi.fn();
const add = vi.fn();
const remove = vi.fn();
vi.mock('../lib/api', () => ({
  api: {
    favourites: {
      ids: () => ids(),
      add: (req: unknown) => add(req),
      remove: (req: unknown) => remove(req),
    },
  },
  unwrap: (res: { status: number; body: unknown }, status: number) => {
    if (res.status !== status) throw new Error(`HTTP ${res.status}`);
    return res.body;
  },
}));

import { HeartButton } from './HeartButton';

const ok = (body: FavouriteIds) => ({ status: 200, body });
const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  ids.mockResolvedValue(ok({ slugs: ['oud'], discoverySet: false }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HeartButton', () => {
  it('is filled for a favourite and empty for any other', async () => {
    wrap(
      <>
        <HeartButton target="oud" name="Oud" />
        <HeartButton target="symphony" name="Symphony" />
      </>,
    );
    const kept = await screen.findByRole('button', { name: 'Убрать из избранного: Oud' });
    expect(kept.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'В избранное: Symphony' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('fills at once on a tap, then follows the server, with a haptic', async () => {
    let done!: (v: unknown) => void;
    add.mockReturnValue(new Promise((r) => (done = r)));
    wrap(<HeartButton target="symphony" name="Symphony" />);
    const heart = await screen.findByRole('button', { name: 'В избранное: Symphony' });
    fireEvent.click(heart);
    // before the server has answered
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Убрать из избранного: Symphony' })).toBeTruthy(),
    );
    expect(add).toHaveBeenCalledWith({ params: { target: 'symphony' } });
    expect(haptic).toHaveBeenCalledOnce();
    done(ok({ slugs: ['symphony', 'oud'], discoverySet: false }));
  });

  it('empties again on a refusal, before anything is re-read', async () => {
    // the re-read after a failure never answers: only the rollback itself can empty the heart
    let reject!: (v: unknown) => void;
    add.mockReturnValue(new Promise((r) => (reject = r)));
    wrap(<HeartButton target="symphony" name="Symphony" />);
    fireEvent.click(await screen.findByRole('button', { name: 'В избранное: Symphony' }));
    const filled = await screen.findByRole('button', { name: 'Убрать из избранного: Symphony' });
    expect(filled.getAttribute('aria-pressed')).toBe('true');
    ids.mockReturnValue(new Promise(() => {}));
    reject({ status: 500, body: {} });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'В избранное: Symphony' }).getAttribute('aria-pressed'),
      ).toBe('false'),
    );
  });

  it('keeps another heart’s change when one is rolled back', async () => {
    let reject!: (v: unknown) => void;
    add.mockImplementation(({ params }: { params: { target: string } }) =>
      params.target === 'symphony' ? new Promise((r) => (reject = r)) : new Promise(() => {}),
    );
    wrap(
      <>
        <HeartButton target="symphony" name="Symphony" />
        <HeartButton target="tygar" name="Tygar" />
      </>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'В избранное: Symphony' }));
    fireEvent.click(screen.getByRole('button', { name: 'В избранное: Tygar' }));
    await screen.findByRole('button', { name: 'Убрать из избранного: Tygar' });
    ids.mockReturnValue(new Promise(() => {}));
    reject({ status: 500, body: {} });
    await screen.findByRole('button', { name: 'В избранное: Symphony' });
    expect(screen.getByRole('button', { name: 'Убрать из избранного: Tygar' })).toBeTruthy();
  });

  it('removes a kept one, and the Discovery set hearts under its own target', async () => {
    remove.mockResolvedValue(ok({ slugs: [], discoverySet: false }));
    add.mockResolvedValue(ok({ slugs: ['oud'], discoverySet: true }));
    wrap(
      <>
        <HeartButton target="oud" name="Oud" />
        <HeartButton target="discovery-set" name="Discovery set" place="disc" />
      </>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать из избранного: Oud' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ params: { target: 'oud' } }));
    fireEvent.click(screen.getByRole('button', { name: 'В избранное: Discovery set' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith({ params: { target: 'discovery-set' } }));
  });
});
