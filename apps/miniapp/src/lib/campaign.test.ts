import { beforeEach, expect, it, vi } from 'vitest';

const navigate = vi.fn();
const open = vi.fn();
vi.mock('../app/router', () => ({ router: { navigate } }));
vi.mock('../app/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('./api', () => ({ api: { campaigns: { open } } }));

const { openCampaignLaunch } = await import('./campaign');

beforeEach(() => {
  navigate.mockReset();
  open.mockReset();
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
