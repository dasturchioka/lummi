/**
 * Shot data for «Карта для оплаты» (#28): the card set twice, so the page shows the current one
 * and the audit holds a masked «было → стало». Both numbers pass the check digit, so the confirm
 * step shows no typo note unless a screen types one. Idempotent: a save that changes nothing
 * writes nothing.
 */
export const SHOT_CARD = { number: '9860100245817364', holder: 'JORAMAXAMADOV FAYZALI' } as const;
const EARLIER_CARD = { number: '8600310477259055', holder: 'JORAMAXAMADOV FAYZALI' } as const;

export async function seedShotShopCard(
  call: (path: string, method: string, body?: unknown) => Promise<Response>,
) {
  const now = (await (await call('/admin/shop-card', 'GET')).json()) as {
    card: { number: string } | null;
  };
  if (now.card?.number === SHOT_CARD.number) return;
  for (const card of [EARLIER_CARD, SHOT_CARD]) {
    const res = await call('/admin/shop-card', 'PUT', card);
    if (res.status !== 200) throw new Error(`could not set the shop card: ${res.status}`);
  }
}
