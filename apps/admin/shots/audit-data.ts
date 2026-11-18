import type { ShotSql } from './screens';

/**
 * Shot data for the audit page (#63): one entry for each family of action the describers read,
 * the legacy banner payload (`switchedOff`), a payload no describer knows, and a long free text.
 * The newest entries sit on page one. Idempotent: the order-9001 cancel marks a seeded database.
 */
export async function seedShotAudit(db: ShotSql) {
  const seeded = await db.query(
    `select 1 from audit_log where action = 'order.cancelled' and payload->>'number' = '9001'`,
    [],
  );
  if (seeded.rows.length > 0) return;
  const staff = (await db.query('select id from staff order by id limit 2', [])).rows as {
    id: number;
  }[];
  const owner = staff[0]?.id ?? null;
  const manager = staff[1]?.id ?? owner;
  const banner = (await db.query('select id from promo_banners order by id limit 1', []))
    .rows[0] as { id: number } | undefined;
  const bannerId = String(banner?.id ?? 2);
  // the object and the details name the same thing: the volume's own fragrance, the manager's own name
  const volume = (
    await db.query(
      'select v.id, f.name from volumes v join fragrances f on f.id = v.fragrance_id order by v.id limit 1',
      [],
    )
  ).rows[0] as { id: number; name: string } | undefined;
  const managerName =
    (
      (await db.query('select name from staff where id = $1', [manager])).rows[0] as
        { name: string } | undefined
    )?.name ?? 'Aziza';
  const rows: [string, number | null, string, string, string | null, Record<string, unknown>][] = [
    [
      'staff',
      manager,
      'order.cancelled',
      'order',
      '9001',
      {
        number: 9001,
        from: 'accepted',
        to: 'cancelled',
        reason: 'out_of_stock',
        note: 'Последний флакон ушёл в другой заказ, покупатель согласен подождать поставку.',
      },
    ],
    [
      'staff',
      manager,
      'order.handed_to_bts',
      'order',
      '9002',
      { number: 9002, from: 'assembling', to: 'handed_to_bts', trackingNumber: 'BTS-7731904' },
    ],
    [
      'ai',
      null,
      'order.payment_confirmed',
      'order',
      '9003',
      {
        number: 9003,
        from: 'receipt_review',
        to: 'payment_confirmed',
        creditId: 41,
        receiptId: 77,
        amountDue: 289000,
        creditAmountTiyin: 28900000,
        differenceTiyin: 0,
        cardLast4: '7364',
        offShopCard: false,
      },
    ],
    ['staff', owner, 'content.banner_activated', 'promo_banner', bannerId, { switchedOff: [2] }],
    [
      'staff',
      owner,
      'content.banner_updated',
      'promo_banner',
      bannerId,
      { changed: { titleRu: ['Зима', 'Новый год с LUMMI.'], active: [false, true] } },
    ],
    [
      'staff',
      owner,
      'promo.updated',
      'promo_code',
      '1',
      { code: 'LUMMI10', changed: { percent: [10, 15], totalLimit: [100, null] } },
    ],
    [
      'staff',
      manager,
      'order.refunded',
      'order',
      '9002',
      {
        number: 9002,
        amount: 50000,
        date: '2026-11-15',
        reason: 'Повреждён флакон при доставке',
        paid: 289000,
        refundedBefore: 0,
      },
    ],
    [
      'staff',
      owner,
      'catalog.on_hand_changed',
      'volume',
      String(volume?.id ?? 1),
      { fragrance: volume?.name ?? 'Tygar', ml: 30, onHand: [12, 9] },
    ],
    [
      'staff',
      owner,
      'staff.created',
      'staff',
      String(manager ?? 1),
      { name: managerName, login: 'aziza', role: 'manager' },
    ],
    [
      'system',
      null,
      'bts_points.imported',
      'bts_points',
      null,
      {
        source: 'bts.uz',
        fetchedAt: '2026-11-17T04:00:00.000Z',
        refresh: false,
        inserted: 3,
        updated: 1,
        unchanged: 241,
      },
    ],
    [
      'customer',
      null,
      'customer.preferences_changed',
      'customer',
      '1',
      { from: { language: 'ru', theme: 'light' }, to: { language: 'uz', theme: 'dark' } },
    ],
    [
      'staff',
      owner,
      'future.report_exported',
      'report',
      null,
      { rangeFrom: '2026-11-01', belowReserve: 3, flags: { drafts: true } },
    ],
  ];
  let minutes = 0;
  for (const [actorType, actorId, action, targetType, targetId, payload] of rows) {
    await db.query(
      `insert into audit_log (actor_type, actor_id, action, target_type, target_id, payload, created_at)
       values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval)`,
      [
        actorType,
        actorId,
        action,
        targetType,
        targetId,
        JSON.stringify(payload),
        String(rows.length - minutes++),
      ],
    );
  }
}
