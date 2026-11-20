import { beforeEach, expect, it, vi } from 'vitest';

const navigate = vi.fn();
const open = vi.fn();
const cartGet = vi.fn();
vi.mock('../app/router', () => ({ router: { navigate } }));
vi.mock('../app/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('./api', () => ({ api: { campaigns: { open }, cart: { get: cartGet } } }));

const { openCampaignLaunch } = await import('./campaign');

beforeEach(() => {
  navigate.mockReset();
  open.mockReset();
  cartGet.mockReset();
  document.body.innerHTML = '';
  document.documentElement.lang = 'ru';
});

const cartWith = (invalid: unknown) => ({
  status: 200,
  body: { quote: { promoCode: { code: 'BLOGER10', invalid } } },
});

it('routes to the target the API names, through the one route table', async () => {
  open.mockResolvedValue({ status: 200, body: { target: 'p_tygar', promoCodePrefilled: true } });
  await openCampaignLaunch('malika');
  expect(navigate).toHaveBeenCalledWith({ to: '/p/tygar', replace: true });
});

it.each([
  ['an unknown code', { status: 404, body: { code: 'not_found' } }],
  ['a guess past the budget', { status: 429, body: { code: 'too_many_attempts' } }],
  ['a signed-out shopper', { status: 401, body: { code: 'unauthorized' } }],
])('%s leaves the shopper on Home, with no error screen and no throw', async (_n, res) => {
  open.mockResolvedValue(res);
  await expect(openCampaignLaunch('nope-nope')).resolves.toBeUndefined();
  expect(navigate).not.toHaveBeenCalled();
});

it('a network failure leaves the shopper on Home too', async () => {
  open.mockRejectedValue(new Error('offline'));
  await expect(openCampaignLaunch('malika')).resolves.toBeUndefined();
  expect(navigate).not.toHaveBeenCalled();
});

it('says once, quietly, that the link’s code is already in the cart', async () => {
  open.mockResolvedValue({ status: 200, body: { target: 'p_tygar', promoCodePrefilled: true } });
  cartGet.mockResolvedValue(cartWith(null));
  await openCampaignLaunch('malika');
  expect(document.querySelectorAll('[data-testid="campaign-note"]')).toHaveLength(1);
  expect(document.body.textContent).toBe('Промокод BLOGER10 уже в корзине');
});

it('says it in Uzbek for a Uzbek shopper', async () => {
  document.documentElement.lang = 'uz';
  open.mockResolvedValue({ status: 200, body: { target: 'catalog', promoCodePrefilled: true } });
  cartGet.mockResolvedValue(cartWith(null));
  await openCampaignLaunch('malika');
  expect(document.body.textContent).toBe('BLOGER10 promokodi savatda');
});

it('stays silent when the code was refused: the cart explains that', async () => {
  open.mockResolvedValue({ status: 200, body: { target: 'p_tygar', promoCodePrefilled: true } });
  cartGet.mockResolvedValue(cartWith({ reason: 'inactive' }));
  await openCampaignLaunch('malika');
  expect(document.body.textContent).toBe('');
});

it('stays silent for a link with no promo code', async () => {
  open.mockResolvedValue({ status: 200, body: { target: 'catalog', promoCodePrefilled: false } });
  await openCampaignLaunch('insta-nov');
  expect(cartGet).not.toHaveBeenCalled();
  expect(document.body.textContent).toBe('');
});
