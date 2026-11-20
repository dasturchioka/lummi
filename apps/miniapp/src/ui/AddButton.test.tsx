import type { CartDto, FragranceListItem, VolumeCard } from '@lummi/contracts';
import { sharedMessages } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language: 'ru',
    theme: 'light',
    t: { ...sharedMessages.ru, ...miniappMessages.ru },
  }),
}));
const haptic = vi.fn();
vi.mock('../lib/telegram', () => ({ hapticSuccess: () => haptic() }));
const addLine = vi.fn();
vi.mock('../lib/api', () => ({
  api: { cart: { addLine: (req: unknown) => addLine(req) } },
  unwrap: (res: { status: number; body: unknown }, status: number) => {
    if (res.status !== status) throw new Error(`HTTP ${res.status}`);
    return res.body;
  },
}));

import { act } from 'react';
import { AddButton } from './AddButton';
import { ShopNote } from './ShopNote';
import { showShopNote } from './ShopNoteHost';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const volume = (ml: VolumeCard['ml'], price: number, available: number): VolumeCard => ({
  ml,
  price,
  salePrice: null,
  salePercent: null,
  saleEndsAt: null,
  effectivePrice: price,
  available,
  shown: available,
  photo: null,
});

const item = (volumes: VolumeCard[]): FragranceListItem => ({
  slug: 'symphony',
  name: 'Symphony',
  brand: 'Louis Vuitton',
  type: 'unisex',
  family: null,
  keyNotes: { ru: [], uz: [] },
  isHit: false,
  isNew: false,
  from: { price: 69_000, ml: 10, regularPrice: null },
  soldOut: false,
  photo: null,
  volumes,
});

const cart = (qty: number, available = 20): CartDto =>
  ({
    lines: [
      {
        kind: 'volume',
        id: 1,
        slug: 'symphony',
        name: 'Symphony',
        brand: 'Louis Vuitton',
        ml: 30,
        photo: null,
        qty,
        available,
        soldOut: false,
        limited: false,
      },
    ],
    count: qty,
  }) as unknown as CartDto;

function renderAdd(it: FragranceListItem) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <div className="relative">
        <AddButton item={it} />
      </div>
      <ShopNote tabBar />
    </QueryClientProvider>,
  );
}

describe('the list card «+» (#25)', () => {
  it('nothing available: no «+»', () => {
    renderAdd(item([volume(10, 69_000, 0), volume(30, 149_000, 0)]));
    expect(screen.queryByTestId('list-add')).toBeNull();
  });

  it('one volume available: adds it at once, with the dock’s haptic and note', async () => {
    addLine.mockResolvedValue({ status: 200, body: cart(1) });
    renderAdd(item([volume(10, 69_000, 0), volume(30, 149_000, 4), volume(50, 219_000, 0)]));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в корзину: Symphony' }));
    await waitFor(() =>
      expect(addLine).toHaveBeenCalledWith({ body: { slug: 'symphony', ml: 30, qty: 1 } }),
    );
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Добавлено в корзину'));
    expect(haptic).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('several available: asks which, on the cheapest first, then adds the chosen one', async () => {
    addLine.mockResolvedValue({ status: 200, body: cart(1) });
    renderAdd(item([volume(10, 69_000, 5), volume(30, 149_000, 5), volume(50, 219_000, 0)]));
    fireEvent.click(screen.getByTestId('list-add'));
    // The sheet is a lazy chunk: on a busy machine its import can take longer than findBy's 1 s.
    const dialog = await screen.findByRole('dialog', { name: 'Выберите объём' }, { timeout: 5000 });
    expect(dialog.textContent).toContain('В корзину');
    expect(screen.getByRole('radio', { name: /10 мл/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /30 мл/ }));
    fireEvent.click(screen.getByRole('button', { name: /В корзину/ }));
    await waitFor(() =>
      expect(addLine).toHaveBeenCalledWith({ body: { slug: 'symphony', ml: 30, qty: 1 } }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a volume that ran out under the sheet turns sold out, names itself, and the choice moves on', async () => {
    addLine.mockResolvedValue({ status: 409, body: { code: 'sold_out' } });
    renderAdd(item([volume(10, 69_000, 5), volume(30, 149_000, 5), volume(50, 219_000, 0)]));
    fireEvent.click(screen.getByTestId('list-add'));
    await screen.findByRole('dialog', { name: 'Выберите объём' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: /В корзину/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      '10 мл закончился — выберите другой объём',
    );
    const ten = screen.getByRole('radio', { name: /10 мл/ });
    expect(ten.hasAttribute('data-sold-out')).toBe(true);
    expect(screen.getByRole('radio', { name: /30 мл/ }).getAttribute('aria-checked')).toBe('true');
    const buy = screen.getByRole('button', { name: /В корзину/ });
    expect(buy.textContent).toContain('149');
    expect((buy as HTMLButtonElement).disabled).toBe(false);
  });

  it('the last volume ran out under the sheet: the button stands down', async () => {
    addLine.mockResolvedValue({ status: 409, body: { code: 'sold_out' } });
    renderAdd(item([volume(10, 69_000, 5), volume(30, 149_000, 1), volume(50, 219_000, 0)]));
    fireEvent.click(screen.getByTestId('list-add'));
    await screen.findByRole('dialog', { name: 'Выберите объём' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: /В корзину/ }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /В корзину/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      '30 мл закончился, других объёмов сейчас нет',
    );
    const buy = screen.getByRole('button', { name: 'Нет в наличии' }) as HTMLButtonElement;
    expect(buy.disabled).toBe(true);
  });

  it('capped by stock: says what is left instead', async () => {
    addLine.mockResolvedValue({ status: 200, body: cart(2, 2) });
    const client = new QueryClient();
    client.setQueryData(['cart'], cart(2, 2));
    render(
      <QueryClientProvider client={client}>
        <AddButton item={item([volume(30, 149_000, 2)])} />
        <ShopNote tabBar={false} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('list-add'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Осталось 2'));
    expect(haptic).not.toHaveBeenCalled();
  });
});

describe('the note a «+» leaves', () => {
  it('belongs to its screen: another screen (the cart, its order button) opens without it', () => {
    const { rerender } = render(<ShopNote tabBar screen="/catalog" />);
    act(() => showShopNote('Добавлено в корзину'));
    expect(screen.getByRole('status').textContent).toBe('Добавлено в корзину');
    rerender(<ShopNote tabBar screen="/cart" />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByTestId('shop-note').hasAttribute('data-open')).toBe(false);
  });
});
