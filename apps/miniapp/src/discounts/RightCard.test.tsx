import type { MyUpgradeRightDto } from '@lummi/contracts';
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

import { RightCard } from './RightCard';

afterEach(() => {
  cleanup();
  language = 'ru';
});

const right = (over: Partial<MyUpgradeRightDto> = {}): MyUpgradeRightDto => ({
  id: 1,
  source: 'set',
  sourceOrderNumber: 1042,
  percent: 20,
  fragrances: [
    { name: 'Symphony', brand: 'Louis Vuitton', slug: 'symphony' },
    { name: 'Megamare', brand: 'Orto Parisi', slug: 'megamare' },
    { name: 'Tygar', brand: 'Bvlgari', slug: null },
    { name: 'Guidance', brand: 'Amouage', slug: 'guidance' },
    { name: 'Blue Sapphire', brand: 'Boadicea', slug: 'blue-sapphire' },
  ],
  lastDay: '2026-12-09',
  daysLeft: 25,
  ...over,
});

describe('RightCard («Мои скидки», TZ §3.4)', () => {
  it('names the discount, its five fragrances with their originals, and how long it lasts', () => {
    render(<RightCard right={right()} fullSizeMl={[30, 50]} onOpen={vi.fn()} />);
    expect(screen.getByText('Скидка за набор')).toBeTruthy();
    expect(screen.getByText('−20%')).toBeTruthy();
    // which set it came from, and what it covers (the volumes from the setting)
    expect(screen.getByText('Набор из заказа № 1042')).toBeTruthy();
    expect(screen.getByText(/^На один полный флакон/).textContent?.replace(/\u00a0/g, ' ')).toBe(
      'На один полный флакон 30 или 50 мл любого аромата из набора. В корзине применится сама.',
    );
    // CLAUDE.md: never a fragrance name without «по мотивам <brand>»
    const items = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/\u00a0/g, ' '));
    expect(items).toEqual([
      'Symphony по мотивам Louis Vuitton',
      'Megamare по мотивам Orto Parisi',
      'Tygar по мотивам Bvlgari',
      'Guidance по мотивам Amouage',
      'Blue Sapphire по мотивам Boadicea',
    ]);
    expect(screen.getByText('Осталось 25 дней · до 9 декабря')).toBeTruthy();
  });

  it('opens the card of a fragrance on sale; a hidden one is plain text', () => {
    const onOpen = vi.fn();
    render(<RightCard right={right()} fullSizeMl={[30, 50]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Megamare' }));
    expect(onOpen).toHaveBeenCalledWith('megamare');
    expect(screen.queryByRole('button', { name: 'Tygar' })).toBeNull();
  });

  it('the last day, in Uzbek, for a right from a 10 ml bottle', () => {
    language = 'uz';
    render(
      <RightCard
        right={right({
          source: 'single_10ml',
          daysLeft: 0,
          fragrances: [{ name: 'Symphony', brand: 'Louis Vuitton', slug: 'symphony' }],
        })}
        fullSizeMl={[50]}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('10 ml flakon chegirmasi')).toBeTruthy();
    expect(screen.getByText('№ 1042 buyurtmadagi 10 ml flakon')).toBeTruthy();
    expect(screen.getByText(/flakoniga\./).textContent?.replace(/\u00a0/g, ' ')).toBe(
      'Shu iforning bitta toʻliq 50 ml flakoniga. Savatda oʻzi qoʻllanadi.',
    );
    expect(screen.getByRole('listitem').textContent?.replace(/\u00a0/g, ' ')).toBe(
      'Symphony Louis Vuitton asosida',
    );
    expect(screen.getByText('Oxirgi kun · 9-dekabrgacha')).toBeTruthy();
  });
});
