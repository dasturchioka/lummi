import { expect, test } from '@playwright/test';
import { signContact } from '@lummi/contracts/sign-contact';
import { fill } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { ordersMessages } from '@lummi/i18n/orders';
import { signInitData, signedInClient, type ShotUser } from '../shots/api';
import { launchHash } from '../shots/stack';
import { E2E } from './env';

const t = miniappMessages.ru;
const o = ordersMessages.ru;
const apiUrl = `http://127.0.0.1:${E2E.apiPort}`;
const appUrl = `http://127.0.0.1:${E2E.appPort}`;

/** The digits of a formatted so'm amount: «243 000 сум» -> 243000 (the separators are no-break spaces). */
const sum = (text: string | null) => Number((text ?? '').replace(/\D/g, ''));

test('a customer buys a fragrance and sends the receipt', async ({ page }) => {
  // A customer of their own per run, so no earlier run leaves anything in the way.
  const user: ShotUser = {
    id: 800_000_000 + Math.floor(Math.random() * 1_000_000),
    first_name: 'Dilnoza',
    last_name: 'Karimova',
    username: 'dilnoza_e2e',
    language_code: 'ru',
  };

  // The stubbed Telegram: the contact share is a proof signed the way the bot signs it, and the
  // saved city is the account state a returning customer has. Everything else goes through the UI.
  const api = await signedInClient(apiUrl, E2E.botToken, user);
  const shared = await api.me.shareContact({
    body: {
      proof: signContact({
        botToken: E2E.botToken,
        userId: user.id,
        phone: `+99890${String(user.id).slice(-7)}`, // a phone of its own: a known one would relink the account
        authDate: Math.floor(Date.now() / 1000),
      }),
    },
  });
  expect(shared.status).toBe(200);
  const regions = await api.delivery.regions();
  if (regions.status !== 200) throw new Error(`regions: HTTP ${regions.status}`);
  const region = regions.body.find((r) => r.nameRu.startsWith('Самаркандская'));
  if (!region) throw new Error('no Samarkand region (bts:import not run?)');
  const city = await api.me.setDeliveryCity({ body: { regionId: region.id, city: 'Самарканд' } });
  expect(city.status).toBe(200);

  // Open the Mini App as Telegram does: signed initData in the launch params.
  const initData = signInitData(E2E.botToken, user);
  await page.goto(`${appUrl}/catalog#${launchHash(initData)}`);

  // Catalog -> a fragrance
  await page
    .getByRole('button', { name: fill(t.list.open, { name: '' }).trim() })
    .first()
    .click();

  // Pick a volume, add to the cart
  await page.getByRole('radio', { name: new RegExp(`^30 ${t.card.ml}`) }).click();
  await expect(page.getByRole('radio', { name: new RegExp(`^30 ${t.card.ml}`) })).toBeChecked();
  await page.getByRole('button', { name: new RegExp(`^${t.card.toCart}`) }).click();

  // Cart -> checkout
  await page.getByRole('button', { name: t.card.back }).click(); // the fragrance page has a dock, not the tab bar
  await page.getByRole('link', { name: new RegExp(`${t.tabs.cart}$`) }).click();
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await page.getByRole('button', { name: new RegExp(t.cart.checkout) }).click();

  // Checkout: recipient (prefilled from Telegram), phone (from the shared contact), a BTS point
  await expect(page.getByRole('textbox', { name: o.checkout.name })).toHaveValue(
    'Dilnoza Karimova',
  );
  await expect(page.getByRole('textbox', { name: o.checkout.accountPhone })).not.toHaveValue('');
  await expect(page.getByRole('textbox', { name: o.checkout.recipientPhone })).not.toHaveValue('');
  await page.getByRole('button', { name: o.checkout.choosePoint }).click();
  await page.getByRole('dialog').getByTestId('point-row').first().click();
  await expect(page.getByRole('dialog')).toBeHidden();
  // the box itself is visually hidden (the whole row is the target): tap the words, assert the checkbox
  await page.getByText(o.checkout.consent).click();
  await expect(page.getByRole('checkbox', { name: o.checkout.consent })).toBeChecked();

  const submit = page.getByRole('button', { name: new RegExp(o.checkout.submit) });
  await expect(submit).toBeEnabled();
  const checkoutTotal = sum(await submit.textContent());
  expect(checkoutTotal).toBeGreaterThan(0);
  await submit.click();

  // Payment screen: the amount equals the checkout total, and the card is shown
  const transfer = page.getByTestId('transfer');
  await expect(transfer).toBeVisible();
  expect(sum(await transfer.getByText(/сум/).first().textContent())).toBe(checkoutTotal);
  await expect(page.getByTestId('card-number')).toContainText('9860');

  // The receipt: a small PNG through the file input, then send
  await page.getByTestId('receipt-input').setInputFiles('e2e/fixtures/receipt.png');
  await page.getByRole('button', { name: o.payment.send }).click();

  // «Чек на проверке»
  await expect(page.getByRole('heading', { name: o.payment.reviewTitle })).toBeVisible();
  await page.goto(`${appUrl}/orders#${launchHash(initData)}`);
  await expect(page.getByText(o.orders.status.receipt_review).first()).toBeVisible();
});
