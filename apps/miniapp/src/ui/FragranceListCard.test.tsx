import type { FragranceListItem } from '@lummi/contracts';
import { sharedMessages, type Language } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let language: Language = 'ru';
vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language,
    theme: 'light',
    t: { ...sharedMessages[language], ...miniappMessages[language] },
  }),
}));

vi.mock('../favourites/queries', () => ({
  useFavouriteIds: () => ({ data: undefined }),
  useToggleFavourite: () => ({ mutate: vi.fn() }),
}));

import { FragranceListCard } from './FragranceListCard';

const item = (over: Partial<FragranceListItem> = {}): FragranceListItem => ({
  slug: 'symphony',
  name: 'Symphony',
  brand: 'Louis Vuitton',
  type: 'unisex',
  family: { ru: 'Цитрусово-древесный', uz: 'Sitrusli yogʻochli' },
  keyNotes: {
    ru: ['лимон', 'ветивер', 'амбра', 'кедр'],
    uz: ['limon', 'vetiver', 'ambra', 'kedr'],
  },
  isHit: false,
  isNew: false,
  from: { price: 99_000, ml: 10, regularPrice: null, wasPrice: null },
  soldOut: false,
  photo: null,
  volumes: [],
  ...over,
});

afterEach(cleanup);

describe('FragranceListCard', () => {
  it('shows the lockup with three notes and the server price', () => {
    language = 'ru';
    render(<FragranceListCard item={item()} />);
    expect(screen.getByText('по мотивам Louis Vuitton')).toBeTruthy();
    expect(screen.getByText('Symphony')).toBeTruthy();
    expect(screen.getByText('лимон · ветивер · амбра')).toBeTruthy();
    expect(screen.getByText(/^99\s000\sсум\s·\s10\sмл$/)).toBeTruthy();
  });

  it('strikes the regular price when the from-price is a markdown (RU)', () => {
    language = 'ru';
    render(
      <FragranceListCard
        item={item({ from: { price: 79_000, ml: 10, regularPrice: 99_000, wasPrice: null } })}
      />,
    );
    expect(screen.getByText(/^79\s000\sсум\s·\s10\sмл$/)).toBeTruthy();
    const struck = screen.getByTestId('regular-price');
    expect(struck.tagName).toBe('S');
    expect(struck.textContent).toMatch(/^99\s000\sсум$/);
  });

  it('strikes the regular price in Uzbek, and shows none without a markdown', () => {
    language = 'uz';
    const { unmount } = render(
      <FragranceListCard
        item={item({ from: { price: 79_000, ml: 10, regularPrice: 99_000, wasPrice: null } })}
      />,
    );
    expect(screen.getByTestId('regular-price').textContent).toMatch(/^99\s000\ssoʻm$/);
    unmount();
    render(<FragranceListCard item={item()} />);
    expect(screen.queryByTestId('regular-price')).toBeNull();
  });

  it('strikes the shown «was» price when there is no markdown', () => {
    language = 'ru';
    render(
      <FragranceListCard
        item={item({ from: { price: 69_000, ml: 10, regularPrice: null, wasPrice: 90_000 } })}
      />,
    );
    expect(screen.getByTestId('regular-price').textContent).toMatch(/^90\s000\sсум$/);
  });

  it('speaks Uzbek', () => {
    language = 'uz';
    render(<FragranceListCard item={item()} />);
    expect(screen.getByText('limon · vetiver · ambra')).toBeTruthy();
    expect(screen.getByText(/^99\s000\ssoʻm\s·\s10\sml$/)).toBeTruthy();
  });

  it('names the volume the price belongs to, with a 7-digit price (RU, UZ)', () => {
    language = 'ru';
    const big = item({ from: { price: 1_249_000, ml: 50, regularPrice: null, wasPrice: null } });
    const { unmount } = render(<FragranceListCard item={big} />);
    expect(screen.getByText(/^1\s249\s000\sсум\s·\s50\sмл$/)).toBeTruthy();
    unmount();
    language = 'uz';
    render(<FragranceListCard item={big} />);
    expect(screen.getByText(/^1\s249\s000\ssoʻm\s·\s50\sml$/)).toBeTruthy();
  });

  it('compact drops the meta and notes; sold out replaces the price', () => {
    language = 'ru';
    render(<FragranceListCard compact item={item({ soldOut: true })} />);
    expect(screen.queryByText(/лимон/)).toBeNull();
    expect(screen.getByText('Нет в наличии')).toBeTruthy();
    expect(screen.queryByText(/сум/)).toBeNull();
  });

  it('selects by slug', () => {
    language = 'ru';
    const onSelect = vi.fn();
    render(<FragranceListCard item={item()} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть Symphony' }));
    expect(onSelect).toHaveBeenCalledWith('symphony');
  });

  it('puts the heart beside the card button, never inside it, and it does not open the card', () => {
    language = 'ru';
    const onSelect = vi.fn();
    render(<FragranceListCard item={item()} onSelect={onSelect} />);
    const heart = screen.getByRole('button', { name: 'В избранное: Symphony' });
    expect(heart.closest('button[aria-label^="Открыть"]')).toBeNull();
    fireEvent.click(heart);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
