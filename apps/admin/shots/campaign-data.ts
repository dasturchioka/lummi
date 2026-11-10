import type { CampaignLinkInput } from '@lummi/contracts';

type Call = (path: string, method: string, body?: unknown) => Promise<Response>;

/** The link the editor and the QR shots open: a stand in a mall, pointing at a fragrance. */
export const SHOT_QR_CODE = 'tc-darvoza';
/** The longest code (40) with the longest label (60): the list's worst row (break-ui). */
export const WORST_LINK_CODE = 'novyi-god-malika-blogger-uzb-samarqand';

/**
 * Shot data for «Ссылки кампаний» (#35), through the owner's endpoints. Every promo code already
 * has its own link (made when #29's shot codes were written); these add the hand-made ones.
 * Idempotent: a code that exists is left alone.
 */
export async function seedShotCampaigns(call: Call) {
  const list = (await (await call('/admin/campaign-links', 'GET')).json()) as { code: string }[];
  const have = new Set(list.map((l) => l.code));
  const links: CampaignLinkInput[] = [
    {
      code: 'insta-nov',
      target: 'catalog',
      promoCode: null,
      source: 'instagram',
      sourceLabel: null,
    },
    {
      code: 'channel-sets',
      target: 'set_discovery',
      promoCode: null,
      source: 'telegram_channel',
      sourceLabel: null,
    },
    {
      code: SHOT_QR_CODE,
      target: 'p_symphony',
      promoCode: 'LUMMI10',
      source: 'store_qr',
      sourceLabel: 'Стойка в ТЦ Samarqand Darvoza',
    },
    {
      code: 'malika',
      target: 'builder',
      promoCode: 'MINUS50',
      source: 'blogger',
      sourceLabel: 'Малика',
    },
    {
      code: WORST_LINK_CODE,
      target: 'p_symphony',
      promoCode: 'BLOGER_MALIKA_NOVOGODNIY_2026_UZ',
      source: 'other',
      sourceLabel: 'Новогодняя рассылка блогеров Самарканда и Ташкента, весна',
    },
  ];
  for (const link of links) {
    if (have.has(link.code!)) continue;
    const res = await call('/admin/campaign-links', 'POST', link);
    if (res.status !== 201) throw new Error(`shot campaign ${link.code}: HTTP ${res.status}`);
  }
}
