import pg from 'pg';

/**
 * Direct access to the dev database for screenshot states the customer API cannot reach
 * (a markdown, a sold-out volume). Development database only; never a real one.
 */
export interface ShotDb {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /** Put a markdown on a volume: `price` so'm, ending at 23:59:59 Tashkent `days` days from now. */
  markdown(slug: string, ml: number, price: number, days: number): Promise<void>;
  /** Clear every markdown and restore a fragrance's concentrate, so a rerun starts from the seed. */
  restore(slug: string): Promise<void>;
  /**
   * Leaves the fragrance concentrate for `onHand` 10 ml bottles (ADR 0043: its volumes share one
   * liquid, a 10 ml fill is 10.3 ml at the default loss); 0 sells it out.
   */
  setOnHand(slug: string, onHand: number): Promise<void>;
  /** Sets the shop card shoppers transfer to (#28); null takes it off, which closes checkout. */
  shopCard(card: { number: string; holder: string } | null): Promise<void>;
  end(): Promise<void>;
}

/**
 * The card the shots pay to: 16 digits that pass the check digit, and a made-up holder as banks
 * show it (the shots reach a customer-facing page: never a real person's name).
 */
export const SHOT_CARD = { number: '9860100245817364', holder: 'RAHIMOVA SEVARA' } as const;

export function connectShotDb(url: string): ShotDb {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const query: ShotDb['query'] = (sql, params) => pool.query(sql, params);
  const volumeOf = `fragrance_id = (select id from fragrances where slug = $1)`;
  return {
    query,
    async markdown(slug, ml, price, days) {
      await query(
        `update volumes set sale_price = $3,
           sale_ends_at = ((now() at time zone 'Asia/Tashkent')::date + $4::int + 1) at time zone 'Asia/Tashkent' - interval '1 second'
         where ${volumeOf} and ml = $2`,
        [slug, ml, price, days],
      );
    },
    async restore(slug) {
      await query(`update volumes set sale_price = null, sale_ends_at = null where ${volumeOf}`, [
        slug,
      ]);
      // the seed's concentrate (PLACEHOLDER_CONCENTRATE_ML)
      await query(`update fragrances set concentrate_ul = 1000000 where slug = $1`, [slug]);
    },
    async setOnHand(slug, onHand) {
      await query(`update fragrances set concentrate_ul = $2 * 10300 where slug = $1`, [
        slug,
        onHand,
      ]);
    },
    async shopCard(card) {
      if (!card) {
        await query('delete from shop_card');
        return;
      }
      await query(
        `insert into shop_card (number, holder) values ($1, $2)
         on conflict (id) do update set number = excluded.number, holder = excluded.holder`,
        [card.number, card.holder],
      );
    },
    end: () => pool.end(),
  };
}
