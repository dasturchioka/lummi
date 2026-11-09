/**
 * Broadcast shot data (ticket #14): 24 customers under reserved Telegram ids (some refused write
 * access or blocked the bot), and three broadcasts written straight to the database, so the shot
 * run never sends anything to Telegram. One is still sending (sent, not delivered, failed and
 * pending all non-zero), one finished with an image and a button, one finished with a worst-case
 * text. Idempotent: it does nothing when the first broadcast is already there.
 */
import pg from 'pg';

const FIRST_ID = 980000001;
const RUNNING_TEXT = 'Новый аромат уже в LUMMI. Откройте каталог и выберите свой вечер.';

export async function seedShotBroadcasts(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const exists = await client.query('select 1 from broadcasts where text_ru = $1', [
      RUNNING_TEXT,
    ]);
    if (exists.rowCount) return;
    for (let i = 0; i < 24; i++) {
      await client.query(
        `insert into customers (telegram_id, first_name, language, bot_blocked, write_access)
         values ($1, $2, $3, $4, $5) on conflict (telegram_id) do nothing`,
        [
          FIRST_ID + i,
          `Клиент ${i + 1}`,
          i % 7 < 4 ? 'ru' : 'uz',
          i % 11 === 10,
          i % 9 === 8 ? 'refused' : 'granted',
        ],
      );
    }
    const { rows: people } = await client.query<{ id: number }>(
      'select id from customers where telegram_id >= $1 and telegram_id < $2 order by id',
      [FIRST_ID, FIRST_ID + 24],
    );
    const owner = await client.query<{ id: number; name: string }>(
      `select id, name from staff where role = 'owner' order by id limit 1`,
    );
    const by = owner.rows[0];
    const insert = async (
      audience: string,
      textRu: string,
      textUz: string,
      imageKey: string | null,
      target: string | null,
      createdAt: string,
      statuses: string[],
    ) => {
      const {
        rows: [row],
      } = await client.query<{ id: number }>(
        `insert into broadcasts (audience, text_ru, text_uz, image_key, button_target, created_by, created_by_name, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          audience,
          textRu,
          textUz,
          imageKey,
          target,
          by?.id ?? null,
          by?.name ?? 'Owner',
          createdAt,
        ],
      );
      for (const [i, status] of statuses.entries()) {
        await client.query(
          `insert into broadcast_deliveries (broadcast_id, customer_id, status, error, sent_at)
           values ($1, $2, $3, $4, $5)`,
          [
            row!.id,
            people[i]!.id,
            status,
            status === 'failed' ? 'chat not found' : status === 'blocked' ? 'blocked (403)' : null,
            status === 'sent' ? createdAt : null,
          ],
        );
      }
    };
    const rep = (status: string, n: number) => Array<string>(n).fill(status);
    // oldest first, so the newest has the highest id and heads the list
    await insert(
      'ru',
      'Спасибо, что вы с нами. В этом месяце набор Discovery из пяти ароматов по 10 мл дешевле на 15%, а если выбрать понравившийся, скидка на полный объём остаётся с вами на 30 дней. Загляните в каталог, когда будет минутка: в нём есть тёплые, древесные и свежие ароматы для вечера, для работы и для долгих прогулок по городу.',
      'Biz bilan boʻlganingiz uchun rahmat.',
      null,
      null,
      '2026-11-03T09:00:00Z',
      [...rep('sent', 9), ...rep('blocked', 1)],
    );
    await insert(
      'uz',
      'Новый набор Discovery уже в продаже.',
      'Yangi Discovery toʻplami sotuvda. Beshta atirni sinab koʻring va oʻzingizniki boʻlganini tanlang.',
      'broadcasts/0123456789abcdef.png',
      'catalog',
      '2026-11-07T11:30:00Z',
      [...rep('sent', 8), 'blocked', 'blocked'],
    );
    await insert(
      'all',
      RUNNING_TEXT,
      'LUMMI da yangi atir bor. Katalogni oching va oʻz oqshomingizni tanlang.',
      null,
      'catalog',
      '2026-11-10T08:15:00Z',
      [...rep('sent', 11), ...rep('blocked', 3), 'failed', ...rep('pending', 9)],
    );
  } finally {
    await client.end();
  }
}
