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
  fromPrice: 99_000,
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
    expect(screen.getByText(/^от 99\s000\sсум$/)).toBeTruthy();
  });

  it('speaks Uzbek', () => {
    language = 'uz';
    render(<FragranceListCard item={item()} />);
    expect(screen.getByText('limon · vetiver · ambra')).toBeTruthy();
    expect(screen.getByText(/dan$/)).toBeTruthy();
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
