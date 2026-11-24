import type { Builder, DiscoverySet, FragranceListItem } from '@lummi/contracts';
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

import { BuilderView, DiscoverySetView } from './Sets';

afterEach(() => {
  cleanup();
  language = 'ru';
});

const item = (n: number): FragranceListItem => ({
  slug: `f-${n}`,
  name: `Fragrance ${n}`,
  brand: 'Louis Vuitton',
  type: 'unisex',
  family: null,
  keyNotes: { ru: ['лимон'], uz: ['limon'] },
  isHit: false,
  isNew: false,
  from: { price: 69_000, ml: 10, regularPrice: null, wasPrice: null },
  soldOut: false,
  photo: null,
  volumes: [],
});
const builder = (n = 7): Builder => ({
  price: 299_000,
  size: 5,
  options: Array.from({ length: n }, (_, i) => item(i + 1)),
});
const set = (over: Partial<DiscoverySet> = {}): DiscoverySet => ({
  vialMl: 10,
  price: 299_000,
  available: 10,
  soldOut: false,
  photo: null,
  uzumUrl: null,
  fragrances: Array.from({ length: 5 }, (_, i) => ({
    slug: `f-${i}`,
    name: `Fragrance ${i}`,
    brand: 'Louis Vuitton',
    keyNotes: { ru: ['лимон'], uz: ['limon'] },
  })),
  ...over,
});

describe('BuilderView', () => {
  it('asks for five and keeps the button off until they are chosen', () => {
    const picked = ['f-1', 'f-2', 'f-3'];
    render(<BuilderView builder={builder()} picked={picked} />);
    expect(screen.getByTestId('chosen').textContent).toBe('Выбрано 3 из 5');
    const button = screen.getByRole('button', { name: 'Выберите ещё 2 аромата' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server price on the button once five are chosen, and locks the rest', () => {
    const picked = ['f-1', 'f-2', 'f-3', 'f-4', 'f-5'];
    const onToggle = vi.fn();
    render(<BuilderView builder={builder()} picked={picked} onToggle={onToggle} />);
    const add = screen.getByRole('button', { name: /В корзину/ });
    expect((add as HTMLButtonElement).disabled).toBe(false);
    expect(add.textContent).toContain('299');
    const locked = screen.getByRole('checkbox', { name: /Fragrance 6/ });
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(locked);
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Fragrance 1/ }));
    expect(onToggle).toHaveBeenCalledWith('f-1');
  });

  it('speaks Uzbek', () => {
    language = 'uz';
    render(<BuilderView builder={builder()} picked={['f-1']} />);
    expect(screen.getByTestId('chosen').textContent).toBe('Tanlandi: 1 / 5');
  });

  it('says so when nothing has a 10 ml left', () => {
    render(<BuilderView builder={builder(0)} picked={[]} />);
    expect(screen.getByText('Сейчас нет ароматов для набора')).toBeTruthy();
  });
});

describe('DiscoverySetView', () => {
  it('lists the five fragrances and adds to the cart', () => {
    const onAdd = vi.fn();
    render(<DiscoverySetView set={set()} onAdd={onAdd} />);
    expect(screen.getAllByText(/Louis Vuitton/i).length).toBeGreaterThanOrEqual(5);
    fireEvent.click(screen.getByRole('button', { name: /В корзину/ }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('shows «Купить на Uzum» only with a link, and shares the set', () => {
    const onShare = vi.fn();
    const { rerender } = render(<DiscoverySetView set={set()} onShare={onShare} />);
    expect(screen.queryByRole('button', { name: /Uzum/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));
    expect(onShare).toHaveBeenCalled();
    rerender(<DiscoverySetView set={set({ uzumUrl: 'https://uzum.uz/set' })} />);
    expect(screen.getByRole('button', { name: /Uzum/ })).toBeTruthy();
  });

  it('is disabled and says why when sold out or incomplete', () => {
    const { rerender } = render(<DiscoverySetView set={set({ soldOut: true, available: 0 })} />);
    expect(
      (screen.getByRole('button', { name: 'Нет в наличии' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    rerender(<DiscoverySetView set={set({ fragrances: [] })} />);
    expect(
      (screen.getByRole('button', { name: 'Набор скоро появится в продаже' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('shows a hidden fragrance without a link', () => {
    const base = set();
    const hidden = { ...base.fragrances[0]!, slug: null, keyNotes: { ru: [], uz: [] } };
    render(
      <DiscoverySetView set={{ ...base, fragrances: [hidden, ...base.fragrances.slice(1)] }} />,
    );
    expect(screen.queryByRole('button', { name: /Fragrance 0/ })).toBeNull();
    expect(screen.getByText('Fragrance 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fragrance 1/ })).toBeTruthy();
  });
});

describe('BuilderView failure', () => {
  it('offers a retry that adds again', () => {
    const onAdd = vi.fn();
    render(
      <BuilderView
        builder={builder()}
        picked={['f-1', 'f-2', 'f-3', 'f-4', 'f-5']}
        failed
        onAdd={onAdd}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onAdd).toHaveBeenCalled();
  });
});
