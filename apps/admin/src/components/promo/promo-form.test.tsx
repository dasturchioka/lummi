// @vitest-environment jsdom
import type { AdminPromoCodeRow } from '@lummi/contracts';
import { adminMessages } from '@lummi/i18n/admin';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromoForm } from './promo-form';
import { PromoList } from './promo-list';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
}));

/** A phone: the native select is the control, as on the owner's own phone. */
beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const choices = [
  { id: 7, name: 'Rain Tea', volumes: [10, 30] },
  { id: 8, name: 'Oud Wood', volumes: [50] },
];

/** The native select a Field labels, by that label. */
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const choose = (label: string, value: string) =>
  fireEvent.change(select(label), { target: { value } });

describe.each(['ru', 'uz'] as const)('the promo form’s gift type (%s, ADR 0039)', (language) => {
  const t = adminMessages[language].admin;
  const m = t.promo;

  it('offers «Подарок» as a type: the gift picker replaces the amount and the cap', () => {
    const { container } = render(
      <PromoForm initial={null} giftChoices={choices} language={language} t={t} />,
    );
    expect([...select(m.kind).options].map((o) => o.textContent)).toContain(m.kinds.gift);
    expect(screen.queryByLabelText(m.percent)).not.toBeNull();

    // the preview shows once the whole code is valid
    fireEvent.change(screen.getByLabelText(m.code), { target: { value: 'RAINTEA' } });
    choose(m.kind, 'gift');
    expect(screen.queryByLabelText(m.percent)).toBeNull();
    expect(screen.queryByLabelText(m.maxDiscount)).toBeNull();
    expect(screen.queryByLabelText(m.amount)).toBeNull();
    // a gift cuts no price: the marked-down switch is gone too
    expect(screen.queryByText(m.appliesToMarkedDown)).toBeNull();
    expect([...select(m.gift).options].map((o) => o.textContent)).toEqual([
      m.giftChoose,
      m.giftDiscovery,
      'Rain Tea',
      'Oud Wood',
    ]);

    // a fragrance asks for its volume, offering only those it is sold in
    choose(m.gift, 'f7');
    expect([...select(m.giftVolume).options].map((o) => o.value)).toEqual(['', '10', '30']);
    choose(m.giftVolume, '10');
    const preview = container.querySelector('[data-promo-preview]');
    expect(preview?.textContent).toContain(
      language === 'ru' ? 'Подарок: Rain Tea 10 мл' : 'Sovgʻa: Rain Tea 10 ml',
    );

    // one volume only: it is taken at once; the Discovery set needs no volume
    choose(m.gift, 'f8');
    expect(select(m.giftVolume).value).toBe('50');
    choose(m.gift, 'discovery');
    expect(screen.queryByLabelText(m.giftVolume)).toBeNull();
    expect(container.querySelector('[data-promo-preview]')?.textContent).toContain(
      `${language === 'ru' ? 'Подарок' : 'Sovgʻa'}: Discovery set`,
    );
  });

  it('says what is missing when saved without a gift or its volume', () => {
    render(<PromoForm initial={null} giftChoices={choices} language={language} t={t} />);
    fireEvent.change(screen.getByLabelText(m.code), { target: { value: 'RAINTEA' } });
    choose(m.kind, 'gift');
    fireEvent.submit(select(m.kind).closest('form')!);
    expect(screen.getByText(m.errors.gift)).not.toBeNull();
    choose(m.gift, 'f7');
    fireEvent.submit(select(m.kind).closest('form')!);
    expect(screen.getByText(m.errors.giftVolume)).not.toBeNull();
  });

  it('the list row names the gift', () => {
    const row: AdminPromoCodeRow = {
      id: 1,
      code: 'RAINTEA',
      kind: 'gift',
      percent: null,
      amount: null,
      maxDiscount: null,
      gift: { kind: 'volume', fragranceId: 7, ml: 10, name: 'Rain Tea', brand: 'Bvlgari' },
      expiresOn: null,
      minOrderTotal: null,
      totalLimit: null,
      perCustomerLimit: null,
      newCustomersOnly: false,
      appliesToMarkedDown: false,
      active: true,
      uses: 0,
      everUsed: false,
      state: 'active',
      createdAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-18T10:00:00.000Z',
      promoCodeId: 1,
      fulfilledOrders: 0,
      netSales: 0,
      statsFrom: '2026-11-18',
      statsTo: '2026-11-18',
      reportFrom: '2026-11-18',
    };
    render(<PromoList items={[row]} language={language} t={t} />);
    expect(
      screen.getAllByText(language === 'ru' ? 'Подарок: Rain Tea 10 мл' : 'Sovgʻa: Rain Tea 10 ml')
        .length,
    ).toBeGreaterThan(0);
  });
});
