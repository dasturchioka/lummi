import type { FragranceCard } from '@lummi/contracts';
import { sharedMessages, type Language } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let language: Language = 'ru';
vi.mock('../../lib/prefs', () => ({
  usePrefs: () => ({
    language,
    theme: 'light',
    t: { ...sharedMessages[language], ...miniappMessages[language] },
  }),
}));
vi.mock('../../lib/share', () => ({ openExternal: vi.fn() }));

import { FragranceView } from './FragranceView';

const card = (over: Partial<FragranceCard> = {}): FragranceCard => ({
  slug: 'symphony',
  name: 'Symphony',
  brand: 'Louis Vuitton',
  type: 'unisex',
  family: { ru: 'Цитрусово-древесный', uz: 'Sitrusli yogʻochli' },
  season: 'all_year',
  timeOfDay: 'day_evening',
  sillage: 'strong',
  longevity: { ru: 'до 24 часов', uz: '24 soatgacha' },
  description: { ru: 'Описание аромата.', uz: 'Ifor tavsifi.' },
  whenToWear: { ru: 'круглый год', uz: 'yil boʻyi' },
  keyNotes: { ru: ['лимон', 'ветивер', 'амбра'], uz: ['limon', 'vetiver', 'ambra'] },
  notes: {
    top: [{ ru: 'лимон', uz: 'limon' }],
    heart: [],
    base: [{ ru: 'амбра', uz: 'ambra' }],
  },
  uzumUrl: null,
  isHit: false,
  isNew: false,
  volumes: [
    {
      ml: 10,
      price: 69_000,
      salePrice: null,
      salePercent: null,
      saleEndsAt: null,
      effectivePrice: 69_000,
      available: 20,
      photo: 'a'.repeat(16),
    },
    {
      ml: 30,
      price: 149_000,
      salePrice: 119_200,
      salePercent: 20,
      saleEndsAt: '2026-11-12T18:59:59.000Z',
      effectivePrice: 119_200,
      available: 5,
      photo: 'b'.repeat(16),
    },
    {
      ml: 50,
      price: 219_000,
      salePrice: null,
      salePercent: null,
      saleEndsAt: null,
      effectivePrice: 219_000,
      available: 0,
      photo: 'c'.repeat(16),
    },
  ],
  ...over,
});

const show = (c: FragranceCard) =>
  render(<FragranceView card={c} onBack={vi.fn()} onShare={vi.fn()} />);
afterEach(() => {
  cleanup();
  language = 'ru';
});

describe('FragranceView', () => {
  it('shows the lockup, the disclaimer and the icon row with «до 24 часов»', () => {
    show(card());
    expect(screen.getByText('по мотивам Louis Vuitton')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Symphony' })).toBeTruthy();
    expect(screen.getByText('Аромат LUMMI по мотивам, не оригинальный парфюм')).toBeTruthy();
    expect(screen.getByText('до 24 часов')).toBeTruthy();
    expect(screen.getByText('Сильный')).toBeTruthy();
    expect(screen.getByText('Круглый год')).toBeTruthy();
    expect(screen.getByText('День и вечер')).toBeTruthy();
    // an empty level is left out of the pyramid
    expect(screen.queryByText('Сердце')).toBeNull();
  });

  it('speaks Uzbek when the customer does', () => {
    language = 'uz';
    show(card());
    expect(screen.getByText('Louis Vuitton asosida')).toBeTruthy();
    expect(screen.getByText('24 soatgacha')).toBeTruthy();
    expect(screen.getByText('LUMMI ifori ilhom asosida yaratilgan, asl parfyum emas')).toBeTruthy();
  });

  it('starts on the first volume in stock and swaps photo, price and availability on selection', () => {
    show(card());
    const img = () => screen.getByRole('img', { name: 'Symphony' }) as HTMLImageElement;
    expect(img().src).toContain('a'.repeat(16));
    expect(img().srcset).toContain('400w');
    expect(img().srcset).toContain('1200w');

    fireEvent.click(screen.getByRole('radio', { name: /30/ }));
    expect(img().src).toContain('b'.repeat(16));

    fireEvent.click(screen.getByRole('radio', { name: /50/ }));
    expect(img().src).toContain('c'.repeat(16));
    expect(document.querySelector('[data-availability="sold-out"]')?.textContent).toBe(
      'Нет в наличии',
    );
    expect(screen.getByRole('radio', { name: /50/ }).getAttribute('data-sold-out')).toBe('true');
  });

  it('strikes the regular price and shows the badge and end date while a markdown is active', () => {
    show(card());
    fireEvent.click(screen.getByRole('radio', { name: /30/ }));
    const struck = document.querySelectorAll('s');
    expect([...struck].some((s) => /149\D000/.test(s.textContent ?? ''))).toBe(true);
    expect(screen.getByText('−20%')).toBeTruthy();
    expect(screen.getByText('до 12 ноября')).toBeTruthy();
  });

  it('shows no markdown furniture without one, and «Купить на Uzum» only with a link', () => {
    const plain = card({
      volumes: card().volumes.map((v) => ({
        ...v,
        salePrice: null,
        salePercent: null,
        saleEndsAt: null,
        effectivePrice: v.price,
      })),
    });
    show(plain);
    expect(document.querySelectorAll('s')).toHaveLength(0);
    expect(screen.queryByText(/−\d+%/)).toBeNull();
    expect(screen.queryByText('Купить на Uzum')).toBeNull();
    cleanup();
    show(card({ uzumUrl: 'https://uzum.uz/x' }));
    expect(within(document.body).getByText('Купить на Uzum')).toBeTruthy();
  });

  it('puts one badge on a card, the hit before the novelty', () => {
    show(card({ isHit: true, isNew: true }));
    expect(screen.getByText('Хит')).toBeTruthy();
    expect(screen.queryByText('Новинка')).toBeNull();
  });
});
