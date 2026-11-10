import type { PromoCodeInput } from '@lummi/contracts';

type Call = (path: string, method: string, body?: unknown) => Promise<Response>;

const base: PromoCodeInput = {
  code: '',
  kind: 'percent',
  percent: null,
  amount: null,
  maxDiscount: null,
  expiresOn: null,
  minOrderTotal: null,
  totalLimit: null,
  perCustomerLimit: null,
  newCustomersOnly: false,
  appliesToMarkedDown: false,
  active: true,
};

/** The longest code the pattern allows (32), with every condition set: the list's worst row. */
export const WORST_PROMO = 'BLOGER_MALIKA_NOVOGODNIY_2026_UZ';

/**
 * Shot data for «Промокоды» (#29): a working code with every condition, a plain one, a fixed
 * amount, one past its last day and one switched off, written through the owner's endpoints
 * (idempotent: a code that exists is left as it is). Uses need orders, so every count is 0.
 */
export async function seedShotPromo(call: Call) {
  const list = (await (await call('/admin/promo-codes', 'GET')).json()) as { code: string }[];
  const have = new Set(list.map((p) => p.code));
  const codes: Partial<PromoCodeInput>[] = [
    { code: 'VESNA', percent: 20, active: false },
    { code: 'OSEN15', percent: 15, expiresOn: '2026-10-31', totalLimit: 200 },
    { code: 'MINUS50', kind: 'fixed', amount: 50_000, minOrderTotal: 250_000, totalLimit: 100 },
    { code: 'LUMMI10', percent: 10 },
    {
      code: WORST_PROMO,
      percent: 15,
      maxDiscount: 1_500_000,
      expiresOn: '2026-12-31',
      minOrderTotal: 1_250_000,
      totalLimit: 1_000_000,
      perCustomerLimit: 1,
      newCustomersOnly: true,
      appliesToMarkedDown: true,
    },
  ];
  for (const c of codes) {
    if (have.has(c.code as string)) continue;
    const res = await call('/admin/promo-codes', 'POST', { ...base, ...c });
    if (res.status !== 201) throw new Error(`promo ${c.code}: ${res.status}`);
  }
}
