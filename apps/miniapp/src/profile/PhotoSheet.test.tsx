import type { CustomerDto } from '@lummi/contracts';
import { sharedMessages, type Language } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const prefs = vi.hoisted(() => ({ language: 'ru', customer: undefined as unknown }));
vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language: prefs.language,
    t: {
      ...sharedMessages[prefs.language as Language],
      ...miniappMessages[prefs.language as Language],
    },
    customer: prefs.customer,
  }),
}));
vi.mock('../lib/back-button', () => ({ showBackButton: () => () => undefined }));
const api = vi.hoisted(() => ({
  uploadPhoto: vi.fn(),
  photoFromTelegram: vi.fn(),
  removePhoto: vi.fn(),
}));
vi.mock('./photo-api', () => api);

import PhotoSheet from './PhotoSheet';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const customer = (over: Partial<CustomerDto> = {}): CustomerDto => ({
  id: 1,
  telegramId: 7,
  firstName: 'Ali',
  lastName: null,
  username: null,
  language: 'ru',
  theme: 'light',
  phone: null,
  writeAccess: null,
  photo: null,
  telegramPhoto: false,
  config: { managerUsername: '@lummi_manager' },
  ...over,
});

function show(language: Language, c: CustomerDto, onOpenChange = vi.fn()) {
  prefs.language = language;
  prefs.customer = c;
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <PhotoSheet open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { queryClient, onOpenChange };
}

describe('profile photo sheet (#67)', () => {
  it('RU: only «Загрузить фото» without a photo and without a Telegram photo', () => {
    show('ru', customer());
    expect(screen.getByRole('button', { name: 'Загрузить фото' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Взять из Telegram' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Убрать фото' })).toBeNull();
  });

  it('RU: all three choices when Telegram gave a photo and the customer has one', () => {
    show('ru', customer({ photo: 'a'.repeat(32), telegramPhoto: true }));
    for (const name of ['Загрузить фото', 'Взять из Telegram', 'Убрать фото']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('UZ: the Uzbek labels', () => {
    show('uz', customer({ photo: 'a'.repeat(32), telegramPhoto: true }));
    for (const name of ['Rasm yuklash', 'Telegram rasmini olish', 'Rasmni olib tashlash']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('taking the Telegram photo saves the returned customer and closes', async () => {
    const next = customer({ photo: 'b'.repeat(32), telegramPhoto: true });
    api.photoFromTelegram.mockResolvedValue({ ok: true, customer: next });
    const { queryClient, onOpenChange } = show('ru', customer({ telegramPhoto: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Взять из Telegram' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(queryClient.getQueryData(['me'])).toEqual(next);
  });

  it('a refused upload says why, in the customer’s language, and stays open', async () => {
    api.uploadPhoto.mockResolvedValue({ ok: false, reason: 'too_large' });
    const { onOpenChange } = show('uz', customer());
    const file = new File([new Uint8Array(4)], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });
    expect(await screen.findByText('Rasm juda katta: 10 MB gacha boʻlishi kerak.')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('removing without a Telegram photo works from the third row', async () => {
    api.removePhoto.mockResolvedValue({ ok: true, customer: customer() });
    show('ru', customer({ photo: 'a'.repeat(32) }));
    fireEvent.click(screen.getByRole('button', { name: 'Убрать фото' }));
    await waitFor(() => expect(api.removePhoto).toHaveBeenCalledTimes(1));
  });
});
