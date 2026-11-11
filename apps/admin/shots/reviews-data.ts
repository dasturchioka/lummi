import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

type Sql = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

/**
 * The reviews panel's shot data (#41): five reviews on the shot orders (9004-9008), two of them
 * published, one with a banned word as a customer would type it (the panel shows it as typed),
 * one with two photos, one with a very long comment, and one with no comment. The photo is the
 * Discovery box shot from `materials/`, stored where the API's `FileStore` keeps review photos.
 * Idempotent: it replaces the reviews of those orders.
 */
export async function seedShotReviews(db: Sql, repoRoot: string, filesDir: string) {
  const media = resolve(filesDir, 'private/reviews');
  mkdirSync(media, { recursive: true });
  for (const n of [1, 2])
    copyFileSync(
      resolve(repoRoot, 'materials/photos/discovery-set-box.jpg'),
      resolve(media, `shot-${n}.jpg`),
    );
  await db.query(
    `delete from reviews where order_id in (select id from orders where number between 9004 and 9008)`,
  );
  const long =
    'Аромат нравится, но стойкость слабее, чем я ожидала: к обеду почти ничего не остаётся. '
      .repeat(5)
      .trim();
  const rows: [number, number, string | null, boolean, number][] = [
    [9004, 5, 'Держится весь день, получила много комплиментов. Спасибо!', true, 0],
    [9005, 2, 'Пахнет как копия, ожидала большего. Флакон пришёл с подтёком.', false, 2],
    [9006, 4, 'Красивый и глубокий аромат, упаковка аккуратная.', true, 1],
    [9007, 1, long, false, 0],
    [9008, 3, null, false, 0],
  ];
  for (const [number, rating, comment, published, daysAgo] of rows) {
    const r = await db.query(
      `insert into reviews (order_id, customer_id, rating, comment, step, post_queued_at, topic_posted_at, published, published_at, created_at)
       select o.id, o.customer_id, $2::smallint, $3::text, 'done', now(), case when $2::smallint <= 3 then now() end, $4::boolean,
              case when $4::boolean then now() - ($5 || ' days')::interval end, now() - ($5 || ' days')::interval
       from orders o where o.number = $1 returning id`,
      [number, rating, comment, published, String(daysAgo)],
    );
    if (number === 9005)
      for (const n of [1, 2])
        await db.query(
          `insert into review_photos (review_id, file_id, file_key) values ($1, 'shot', $2)`,
          [r.rows[0]!.id, `private/reviews/shot-${n}.jpg`],
        );
  }
}
