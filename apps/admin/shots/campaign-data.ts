import pg from 'pg';
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

const OPENER_IDS = [981000001, 981000002, 981000003];

/**
 * Opens for the list shot: repeat opens by one customer, so «Открыли (чел.)» visibly counts people
 * and not taps. `tc-darvoza`: 5 opens by 2 people; `insta-nov`: 4 opens by 3. Written straight to
 * the database (the real endpoint needs a session per customer); idempotent.
 */
export async function seedShotOpens(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const [i, id] of OPENER_IDS.entries())
      await client.query(
        `insert into customers (telegram_id, first_name, language) values ($1, $2, 'ru')
         on conflict (telegram_id) do nothing`,
        [id, `Клиент ${i + 1}`],
      );
    await client.query(
      `delete from campaign_opens where customer_id in (select id from customers where telegram_id = any($1))`,
      [OPENER_IDS],
    );
    const plan: [code: string, opener: number][] = [
      [SHOT_QR_CODE, 0],
      [SHOT_QR_CODE, 0],
      [SHOT_QR_CODE, 0],
      [SHOT_QR_CODE, 1],
      [SHOT_QR_CODE, 1],
      ['insta-nov', 0],
      ['insta-nov', 0],
      ['insta-nov', 1],
      ['insta-nov', 2],
    ];
    for (const [n, [code, opener]] of plan.entries())
      await client.query(
        `insert into campaign_opens (link_id, customer_id, opened_at)
         select l.id, c.id, now() - ($3 || ' hours')::interval
         from campaign_links l, customers c where l.code = $1 and c.telegram_id = $2`,
        [code, OPENER_IDS[opener], String(n + 1)],
      );
  } finally {
    await client.end();
  }
}
