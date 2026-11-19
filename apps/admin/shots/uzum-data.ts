import type { Screen, ShotSql } from './screens';

/**
 * Uzum sales shot data (#80), written straight to the shot database and removed after each screen:
 * a two-line sale with its frozen profit, the Discovery set from a file, a sale whose fragrance had
 * no oil price, and a voided one with a long Uzum order number and a long reason. Display only:
 * no on hand moves and no history lines. Figures are made up.
 */
const profit = (revenue: number, goods: number) => {
  const commission = Math.round(revenue * 0.205);
  const tax = Math.round(revenue * 0.01);
  const cost = goods + commission + 3_000 + tax;
  return {
    channel: 'uzum',
    revenue,
    goods,
    mailer: 0,
    btsCharge: 0,
    deliveryPaid: 0,
    commissionPercent: 20.5,
    commission,
    adPerSale: 3_000,
    taxPercent: 1,
    tax,
    giftSample: 0,
    cost,
    profit: revenue - cost,
    margin: (revenue - cost) / revenue,
  };
};

type Line = {
  volumeMl: number | null;
  fragranceId: number | null;
  qty: number;
  price: number;
  unitCost: number | null;
};
type Sale = {
  soldOn: string;
  order: string;
  source: 'form' | 'import';
  lines: Line[];
  costed: boolean;
  voidReason?: string;
};

const SALES: Sale[] = [
  {
    soldOn: '2026-11-18',
    order: '41207731',
    source: 'form',
    costed: true,
    lines: [
      { volumeMl: 10, fragranceId: 1, qty: 2, price: 69_000, unitCost: 22_462 },
      { volumeMl: 30, fragranceId: 2, qty: 1, price: 189_000, unitCost: 52_086 },
    ],
  },
  {
    soldOn: '2026-11-17',
    order: '41199502',
    source: 'import',
    costed: true,
    lines: [{ volumeMl: null, fragranceId: null, qty: 1, price: 299_000, unitCost: 120_400 }],
  },
  {
    soldOn: '2026-11-17',
    order: '41199488',
    source: 'form',
    costed: false,
    lines: [{ volumeMl: 50, fragranceId: 3, qty: 1, price: 249_000, unitCost: null }],
  },
  {
    soldOn: '2026-11-15',
    order: 'UZM-2026-11-15-000000000000041188807',
    source: 'form',
    costed: true,
    voidReason: 'Покупатель отказался на пункте выдачи Uzum, посылка вернулась на склад целой',
    lines: [{ volumeMl: 10, fragranceId: 1, qty: 1, price: 69_000, unitCost: 22_462 }],
  },
];

async function someUzumSales(db: ShotSql) {
  const [staff] = (
    await db.query(`select id from staff where role = 'manager' order by id limit 1`)
  ).rows;
  const [owner] = (await db.query(`select id from staff where role = 'owner' order by id limit 1`))
    .rows;
  const by = staff?.id ?? owner?.id;
  for (const s of SALES) {
    const revenue = s.lines.reduce((sum, l) => sum + l.qty * l.price, 0);
    const goods = s.lines.reduce((sum, l) => sum + (l.unitCost ?? 0) * l.qty, 0);
    const costs = {
      at: `${s.soldOn}T09:00:00.000Z`,
      profit: s.costed ? profit(revenue, goods) : null,
      missing: s.costed ? [] : ['Bvlgari Tygar'],
    };
    const [row] = (
      await db.query(
        `insert into uzum_sales (sold_on, uzum_order, commission_percent, revenue, costs, source,
           created_by, voided_at, void_reason, voided_by)
         values ($1::date, $2, 20.5, $3::int, $4::jsonb, $5::uzum_sale_source, $6::bigint, $7::timestamptz, $8, $9::bigint) returning id`,
        [
          s.soldOn,
          s.order,
          revenue,
          JSON.stringify(costs),
          s.source,
          by,
          s.voidReason ? `${s.soldOn}T12:00:00Z` : null,
          s.voidReason ?? null,
          s.voidReason ? (owner?.id ?? by) : null,
        ],
      )
    ).rows;
    for (const [position, l] of s.lines.entries()) {
      await db.query(
        `insert into uzum_sale_lines (sale_id, position, kind, volume_id, fragrance_id, name, ml, qty,
           price, line_total, unit_cost)
         select $1::bigint, $2::smallint, $3::uzum_sale_line_kind, v.id, f.id, f.name, $4::smallint,
           $5::int, $6::int, $5::int * $6::int, $7::int
         from (select 1) one
         left join fragrances f on f.id = $8::bigint
         left join volumes v on v.fragrance_id = f.id and v.ml = $4::smallint`,
        [
          row!.id,
          position,
          l.volumeMl === null ? 'discovery_set' : 'volume',
          l.volumeMl ?? 10,
          l.qty,
          l.price,
          l.unitCost,
          l.fragranceId,
        ],
      );
    }
  }
}
async function noUzumSales(db: ShotSql) {
  await db.query('delete from uzum_sale_lines');
  await db.query('delete from uzum_sales');
}

export const uzumScreens: Screen[] = [
  {
    id: 'uzum',
    path: '/uzum',
    as: 'owner',
    setup: ({ db }) => someUzumSales(db),
    teardown: ({ db }) => noUzumSales(db),
  },
  {
    id: 'uzum-manager',
    path: '/uzum',
    as: 'manager',
    setup: ({ db }) => someUzumSales(db),
    teardown: ({ db }) => noUzumSales(db),
  },
  { id: 'uzum-empty', path: '/uzum', as: 'manager' },
  { id: 'uzum-import', path: '/uzum/import', as: 'manager' },
];
