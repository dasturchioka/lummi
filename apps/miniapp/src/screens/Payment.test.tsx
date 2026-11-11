import type { OrderDto, PaymentDto, ReceiptSummaryDto } from '@lummi/contracts';
import { sharedMessages } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let language: 'ru' | 'uz' = 'ru';
vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language,
    theme: 'light',
    t: { ...sharedMessages[language], ...miniappMessages[language] },
    customer: { config: { managerUsername: '@lummi_shop' } },
  }),
}));
vi.mock('../lib/telegram', () => ({
  openManagerChat: () => undefined,
  hapticSuccess: () => undefined,
}));
vi.mock('../lib/api', () => ({ api: {}, unwrap: () => undefined, session: {} }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ number: '1001' }),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { PaymentView } from './Payment';

const order: OrderDto = {
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
  lines: [],
  itemsSubtotal: 69_000,
  discount: null,
  deliveryFee: 25_000,
  thresholdBase: 'before',
  thresholdBaseAmount: 69_000,
  total: 94_000,
  amountDue: 94_000,
  cancellation: null,
};

const receipt = (state: ReceiptSummaryDto['state']): ReceiptSummaryDto => ({
  id: 7,
  state,
  createdAt: '2026-11-09T10:05:00.000Z',
  fileName: 'chek.png',
  size: 120_000,
  kind: 'image',
});

function renderPayment(receipts: ReceiptSummaryDto[]) {
  const payment: PaymentDto = {
    order,
    card: { number: '9860123456781234', holder: 'LUMMI TEST' },
    receipts,
    maxUploadBytes: 10 * 1024 * 1024,
  };
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PaymentView payment={payment} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  language = 'ru';
});

describe('the payment screen after the last receipt found no money (#36)', () => {
  it('says the transfer was not found, with the receipt’s time, above the payment', () => {
    renderPayment([receipt('not_found')]);
    const note = screen.getByTestId('last-receipt-note');
    expect(note.textContent).toContain('Мы не нашли перевод');
    expect(note.textContent).toContain('По чеку от 9 ноября, 15:05');
    expect(screen.getByTestId('pay-until')).toBeTruthy();
  });

  it('a repeated receipt asks for this order’s own transfer, in Uzbek too', () => {
    language = 'uz';
    renderPayment([receipt('repeat')]);
    expect(screen.getByTestId('last-receipt-note').textContent).toContain(
      'Bu chek boshqa buyurtmaga yuborilgan',
    );
  });

  it('no note before the first receipt, nor after one a manager rejected', () => {
    renderPayment([]);
    expect(screen.queryByTestId('last-receipt-note')).toBeNull();
    cleanup();
    renderPayment([receipt('rejected'), receipt('not_found')]);
    expect(screen.queryByTestId('last-receipt-note')).toBeNull();
  });
});
