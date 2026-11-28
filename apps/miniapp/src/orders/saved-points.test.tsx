import type { SavedPointDto } from '@lummi/contracts';
import { sharedMessages, type Language } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let language: Language = 'uz';
vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language,
    theme: 'light',
    t: { ...sharedMessages[language], ...miniappMessages[language] },
  }),
}));
vi.mock('../lib/api', () => ({ api: {}, unwrap: () => undefined }));

import { SavedPointPicker } from './saved-points';

afterEach(() => {
  cleanup();
  language = 'uz';
});

const pair: SavedPointDto = {
  id: 1,
  recipientName: 'Dilnoza Karimova',
  recipientPhone: '+998901234567',
  point: {
    id: 7,
    code: '57',
    regionId: 3,
    city: 'Самарканд',
    name: 'FIRDAVSIY',
    address: 'Г.Самарканд, ул.Гагарина, 155',
    landmark: null,
    hours: null,
  },
  region: {
    id: 3,
    nameRu: 'Самаркандская область',
    nameUz: 'Samarqand viloyati',
    deliveryTariff: 25_000,
  },
  hidden: false,
  lastUsedAt: '2026-11-11T10:00:00.000Z',
};

describe('«Мои пункты BTS»: the place in the shopper’s language (#23 rule)', () => {
  it('UZ names the region in UZ, never the Cyrillic city; the street stays as BTS gives it', () => {
    render(<SavedPointPicker saved={[pair]} isSelected={() => true} onPick={() => undefined} />);
    const row = screen.getByTestId('saved-point');
    expect(row.textContent).toContain('Samarqand viloyati');
    expect(row.textContent).not.toMatch(/Самарканд ·|^Самарканд$/);
    expect(row.textContent).toContain('ул.Гагарина, 155');
  });

  it('RU names the city', () => {
    language = 'ru';
    render(<SavedPointPicker saved={[pair]} isSelected={() => true} onPick={() => undefined} />);
    expect(screen.getByTestId('saved-point').textContent).toContain('Самарканд ·');
  });
});
