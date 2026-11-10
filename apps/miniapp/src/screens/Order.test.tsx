import type { OrderDto } from '@lummi/contracts';
import { sharedMessages } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const openManagerChat = vi.fn();
let managerUsername: string | undefined = '@lummi_shop';
vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language: 'ru',
    theme: 'light',
    t: { ...sharedMessages.ru, ...miniappMessages.ru },
    customer: managerUsername ? { config: { managerUsername } } : undefined,
  }),
}));
vi.mock('../lib/telegram', () => ({ openManagerChat: (u: string) => openManagerChat(u) }));
vi.mock('../lib/api', () => ({ api: {}, unwrap: vi.fn(), session: {} }));

import { OrderView } from './Order';

const order = (over: Partial<OrderDto> = {}): OrderDto => ({
  number: 1001,
  status: 'awaiting_payment',
  createdAt: '2026-11-09T10:00:00.000Z',
  reserveUntil: '2026-11-09T22:00:00.000Z',
  recipient: { name: 'Dilnoza Karimova', phone: '+998901234567' },
  delivery: {
    region: { ru: 'Самаркандская область', uz: 'Samarqand viloyati' },
    point: {
      code: '57',
      name: 'FIRDAVSIY',
      city: 'Самарканд',
      address: 'ул. Гагарина, 155',
      landmark: null,
      hours: null,
    },
    typed: null,
  },
  comment: null,
  gift: { isGift: false, message: null },
  lines: [
    {
      kind: 'volume',
      slug: 'symphony',
      name: { ru: 'Symphony', uz: 'Symphony' },
      brand: 'Louis Vuitton',
      ml: 10,
      photo: null,
      unitPrice: 69_000,
      regularUnitPrice: 69_000,
      markedDown: false,
      qty: 1,
      lineTotal: 69_000,
      setComposition: null,
    },
  ],
  itemsSubtotal: 69_000,
  discount: null,
  deliveryFee: 25_000,
  thresholdBase: 'before',
  thresholdBaseAmount: 69_000,
  total: 94_000,
  amountDue: 94_000,
  ...over,
});

afterEach(() => {
  cleanup();
  openManagerChat.mockReset();
  managerUsername = '@lummi_shop';
});

describe('order detail', () => {
  it('opens the manager account from the customer config («Написать менеджеру»)', () => {
    render(<OrderView order={order()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Написать менеджеру' }));
    expect(openManagerChat).toHaveBeenCalledWith('@lummi_shop');
  });

  it('leaves the link out until the config has arrived', () => {
    managerUsername = undefined;
    render(<OrderView order={order()} />);
    expect(screen.queryByRole('button', { name: 'Написать менеджеру' })).toBeNull();
  });

  it('marks a gift with its greeting and flags a typed address', () => {
    render(
      <OrderView
        order={order({
          gift: { isGift: true, message: 'С днём рождения!' },
          delivery: {
            region: { ru: 'Самаркандская область', uz: 'Samarqand viloyati' },
            point: null,
            typed: 'Ургут, рядом с базаром',
          },
        })}
      />,
    );
    expect(screen.getByTestId('gift-mark').textContent).toContain('«С днём рождения!»');
    expect(screen.getByTestId('order-delivery').textContent).toContain('Адрес указан вручную');
    expect(screen.getByTestId('order-delivery').textContent).toContain('Ургут, рядом с базаром');
  });
});

describe('set lines', () => {
  it('names the five fragrances of a set with their attribution', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, brand: 'Louis Vuitton' }));
    render(
      <OrderView
        order={order({
          lines: [
            {
              kind: 'discovery_set',
              slug: null,
              name: { ru: 'Discovery set', uz: 'Discovery set' },
              brand: null,
              ml: 10,
              photo: null,
              unitPrice: 299_000,
              regularUnitPrice: 299_000,
              markedDown: false,
              qty: 1,
              lineTotal: 299_000,
              setComposition: five,
            },
          ],
        })}
      />,
    );
    const list = screen.getByTestId('set-fragrances');
    expect(list.querySelectorAll('li')).toHaveLength(5);
    expect(list.textContent).toContain('Louis Vuitton');
  });
});
