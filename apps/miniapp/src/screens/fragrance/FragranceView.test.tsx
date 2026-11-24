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

vi.mock('../../favourites/queries', () => ({
  useFavouriteIds: () => ({ data: undefined }),
  useToggleFavourite: () => ({ mutate: vi.fn() }),
}));

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
      wasPrice: null,
      available: 20,
      shown: 7,
      photo: 'a'.repeat(16),
    },
    {
      ml: 30,
      price: 149_000,
      salePrice: 119_200,
      salePercent: 20,
      saleEndsAt: '2026-11-12T18:59:59.000Z',
      effectivePrice: 119_200,
      wasPrice: null,
      available: 5,
      shown: 5,
      photo: 'b'.repeat(16),
    },
    {
      ml: 50,
      price: 219_000,
      salePrice: null,
      salePercent: null,
      saleEndsAt: null,
      effectivePrice: 219_000,
      wasPrice: null,
      available: 0,
      shown: 0,
      photo: 'c'.repeat(16),
    },
  ],
  upgradeRightPrices: [],
  fullSizeMl: [30, 50],
  stepUps: [],
  showAvailableCount: true,
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

  it('shows the server-capped count for the chosen volume, RU and UZ (#70, #83)', () => {
    const status = () => document.querySelector('[data-availability="in-stock"]')?.textContent;
    language = 'ru';
    const { unmount } = show(card());
    expect(status()).toMatch(/^В наличии: 7\sшт\.$/);
    fireEvent.click(screen.getByRole('radio', { name: /30/ }));
    expect(status()).toMatch(/^В наличии: 5\sшт\.$/);
    unmount();
    language = 'uz';
    show(card());
    expect(status()).toMatch(/^Sotuvda bor: 7\sdona$/);
  });

  it('shows plain «В наличии» when the owner hides the count', () => {
    language = 'ru';
    show(card({ showAvailableCount: false }));
    expect(document.querySelector('[data-availability="in-stock"]')?.textContent).toBe('В наличии');
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
        wasPrice: null,
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

  describe('an upgrade right (TZ §3.4 «Скидка за набор»)', () => {
    /** No markdown, 50 ml in stock, and the customer's right on both full-size volumes. */
    const withRight = (source: 'set' | 'single_10ml' = 'set') =>
      card({
        volumes: card().volumes.map((v) => ({
          ...v,
          salePrice: null,
          salePercent: null,
          saleEndsAt: null,
          effectivePrice: v.price,
          wasPrice: null,
          available: 5,
          shown: 5,
        })),
        upgradeRightPrices: [
          { ml: 30, price: 119_200, source, percent: 20, lastDay: '2026-12-09' },
          { ml: 50, price: 175_200, source, percent: 20, lastDay: '2026-12-09' },
        ],
      });

    it('strikes the regular price on the covered tiles and names the discount for the chosen one', () => {
      show(withRight());
      // 10 ml is chosen first: no right on it
      expect(screen.queryByTestId('right-deal')).toBeNull();
      const tile = screen.getByRole('radio', { name: /30/ });
      expect(
        within(tile)
          .getByText(/149\D000/)
          .closest('s'),
      ).toBeTruthy();
      expect(within(tile).getByText(/119\D200/)).toBeTruthy();
      fireEvent.click(tile);
      const deal = screen.getByTestId('right-deal');
      expect(deal.textContent).toContain('Скидка за набор −20%');
      expect(deal.textContent).toContain('до 9 декабря');
      // what the 20 % covers, the volumes from the setting
      expect(deal.textContent?.replace(/\u00a0/g, ' ')).toContain(
        'на один флакон 30 или 50 мл · применится в корзине',
      );
      // the dock agrees with the tile: the right price, the regular one struck (ruling 2026-11-11)
      const dock = screen.getByRole('button', { name: /В корзину/ });
      expect(dock.textContent).toMatch(/119\D200/);
      expect(dock.querySelector('s')?.textContent).toMatch(/149\D000/);
    });

    it('the dock keeps the bottle price on a volume the right does not cover', () => {
      show(withRight());
      const dock = screen.getByRole('button', { name: /В корзину/ });
      expect(dock.textContent).toMatch(/69\D000/);
      expect(dock.querySelector('s')).toBeNull();
    });

    it('names only the full-size volumes the setting gives', () => {
      show({ ...withRight(), fullSizeMl: [50] });
      fireEvent.click(screen.getByRole('radio', { name: /30/ }));
      expect(screen.getByTestId('right-deal').textContent?.replace(/\u00a0/g, ' ')).toContain(
        'на один флакон 50 мл',
      );
    });

    it('in Uzbek, and for a right from a 10 ml bottle', () => {
      language = 'uz';
      show(withRight('single_10ml'));
      fireEvent.click(screen.getByRole('radio', { name: /50/ }));
      const deal = screen.getByTestId('right-deal');
      expect(deal.textContent).toContain('10 ml uchun chegirma −20%');
      expect(deal.textContent).toContain('9-dekabrgacha');
      expect(deal.textContent?.replace(/\u00a0/g, ' ')).toContain(
        'bitta 30 yoki 50 ml flakonga · savatda qoʻllanadi',
      );
    });

    it('never on a sold-out volume', () => {
      const c = withRight();
      show({ ...c, volumes: c.volumes.map((v) => (v.ml === 30 ? { ...v, available: 0 } : v)) });
      fireEvent.click(screen.getByRole('radio', { name: /30/ }));
      expect(screen.queryByTestId('right-deal')).toBeNull();
    });
  });

  describe('the step-up under the tiles (#57, #60)', () => {
    const steps = { stepUps: [{ fromMl: 10 as const, toMl: 30 as const, saving: 58_000 }] };
    const text = () => screen.getByTestId('step-up').textContent?.replace(/[\u00a0\u202f]/g, ' ');

    it('offers the next volume with what it saves, and a tap chooses it', () => {
      show(card(steps));
      expect(text()).toBe('С 30 мл экономия 58 000 сум');
      expect(
        screen
          .getByTestId('step-up')
          .getAttribute('aria-label')
          ?.replace(/[\u00a0\u202f]/g, ' '),
      ).toBe('С 30 мл экономия 58 000 сум: выбрать 30 мл');
      fireEvent.click(screen.getByTestId('step-up'));
      expect(screen.getByRole('radio', { name: /30/ }).getAttribute('aria-checked')).toBe('true');
      // 30 ml has no step-up of its own here: the row goes
      expect(screen.queryByTestId('step-up')).toBeNull();
    });

    it('in Uzbek', () => {
      language = 'uz';
      show(card(steps));
      expect(text()).toBe('30 ml olsangiz, 58 000 soʻm tejaysiz');
    });

    it('draws nothing without a step-up for the chosen volume', () => {
      show(card());
      expect(screen.queryByTestId('step-up')).toBeNull();
    });

    it('hands the focus to the chosen tile, so it is announced and the keyboard stays put', () => {
      show(card(steps));
      screen.getByTestId('step-up').focus();
      fireEvent.click(screen.getByTestId('step-up'));
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: /30/ }));
    });

    it('never from a sold-out volume, whatever the answer says', () => {
      const c = card(steps);
      show({ ...c, volumes: c.volumes.map((v) => (v.ml === 10 ? { ...v, available: 0 } : v)) });
      fireEvent.click(screen.getByRole('radio', { name: /10/ }));
      expect(screen.queryByTestId('step-up')).toBeNull();
    });
  });
});
