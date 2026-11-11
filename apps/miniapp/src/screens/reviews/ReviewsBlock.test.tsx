import type { ReviewsBlock as Block } from '@lummi/contracts';
import { sharedMessages } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prefs', () => ({
  usePrefs: () => ({
    language: 'ru',
    theme: 'light',
    t: { ...sharedMessages.ru, ...miniappMessages.ru },
  }),
}));
const forTarget = vi.fn();
vi.mock('../../lib/api', () => ({
  API_BASE: '/api',
  api: { reviews: { forTarget: (req: unknown) => forTarget(req) } },
  unwrap: (res: { status: number; body: unknown }, status: number) => {
    if (res.status !== status) throw new Error(`HTTP ${res.status}`);
    return res.body;
  },
}));

import { ReviewsBlock } from './ReviewsBlock';

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
afterEach(() => {
  cleanup();
  forTarget.mockReset();
});

const review = (id: number, over: Partial<Block['items'][number]> = {}) => ({
  id,
  rating: 5,
  comment: 'Держится весь день',
  firstName: 'Севара',
  publishedAt: '2026-11-09T10:00:00.000Z',
  photos: [],
  ...over,
});

describe('the reviews block', () => {
  it('asks for its own target and shows the average, the count, the reviews and their photos', async () => {
    const key = '3b241101-e2bb-4255-8caf-4136c566a962';
    forTarget.mockResolvedValue({
      status: 200,
      body: {
        average: 4.5,
        count: 2,
        items: [review(1, { photos: [key] }), review(2, { rating: 4, comment: null })],
      },
    });
    wrap(<ReviewsBlock target="symphony" />);
    expect((await screen.findByTestId('reviews-average')).textContent).toBe('4,5');
    expect(forTarget).toHaveBeenCalledWith({ params: { target: 'symphony' } });
    expect(screen.getByText('2 отзыва')).toBeTruthy();
    const items = screen.getAllByTestId('review');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Держится весь день')).toBeTruthy();
    expect(within(items[0]!).getByRole('img', { name: 'Оценка 5 из 5' })).toBeTruthy();
    expect(within(items[0]!).getByAltText('Фото покупателя').getAttribute('src')).toBe(
      `/api/reviews/photos/${key}.jpg`,
    );
    expect(within(items[1]!).queryByAltText('Фото покупателя')).toBeNull();
  });

  it('says so when there are no reviews', async () => {
    forTarget.mockResolvedValue({ status: 200, body: { average: null, count: 0, items: [] } });
    wrap(<ReviewsBlock target="discovery-set" />);
    expect(await screen.findByText('Пока нет отзывов')).toBeTruthy();
    expect(screen.queryByTestId('review')).toBeNull();
  });

  it('leaves the section out when it cannot load, so the card is never held up', async () => {
    forTarget.mockResolvedValue({ status: 500, body: {} });
    wrap(<ReviewsBlock target="symphony" />);
    await waitFor(() => expect(screen.queryByTestId('reviews-block')).toBeNull());
  });

  it('reads the average with the locale comma, aloud too, and fills the fifth star by its share', async () => {
    forTarget.mockResolvedValue({
      status: 200,
      body: { average: 4.7, count: 3, items: [review(1)] },
    });
    wrap(<ReviewsBlock target="symphony" />);
    const stars = await screen.findByRole('img', { name: 'Средняя оценка 4,7 из 5' });
    const fills = [...stars.querySelectorAll<HTMLElement>('span.overflow-hidden')];
    expect(fills.map((f) => f.style.width)).toEqual(['100%', '100%', '100%', '100%', '70%']);
  });

  it('opens a photo in the viewer and closes it again', async () => {
    const keys = ['3b241101-e2bb-4255-8caf-4136c566a962', '4b241101-e2bb-4255-8caf-4136c566a962'];
    forTarget.mockResolvedValue({
      status: 200,
      body: { average: 5, count: 1, items: [review(1, { photos: keys })] },
    });
    wrap(<ReviewsBlock target="symphony" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Фото 2 из 2' }));
    const viewer = await screen.findByTestId('photo-viewer', {}, { timeout: 5000 });
    expect(viewer.className).toMatch(/\bbg-bar\b/);
    expect(within(viewer).getAllByAltText('Фото покупателя')).toHaveLength(2);
    fireEvent.click(within(viewer).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByTestId('photo-viewer')).toBeNull());
  });
});
