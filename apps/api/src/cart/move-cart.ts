import { cartLines, carts, eq, sql, type DbOrTx } from '@lummi/db';

/**
 * Relink (ADR 0032): the merged-away customer's cart joins the older customer's. Lines of the same
 * volume (or the same set) add up (the read caps the total at available); the older cart keeps its own discount
 * choice and promo code and only fills the ones it lacks.
 */
export async function moveCartData(
  tx: DbOrTx,
  fromId: number,
  toId: number,
  now: Date,
): Promise<void> {
  const [from] = await tx.select().from(carts).where(eq(carts.customerId, fromId));
  await tx.execute(sql`
    insert into cart_lines (customer_id, volume_id, qty)
    select ${toId}, volume_id, qty from cart_lines where customer_id = ${fromId} and kind = 'volume'
    on conflict (customer_id, volume_id) do update set qty = cart_lines.qty + excluded.qty
  `);
  // set lines (ADR 0009): the Discovery set adds up, and so do builder sets of the same five
  await tx.execute(sql`
    insert into cart_lines (customer_id, kind, qty)
    select ${toId}, kind, qty from cart_lines where customer_id = ${fromId} and kind = 'discovery'
    on conflict (customer_id) where kind = 'discovery' do update set qty = cart_lines.qty + excluded.qty
  `);
  await tx.execute(sql`
    insert into cart_lines (customer_id, kind, fragrance_ids, qty)
    select ${toId}, kind, fragrance_ids, qty from cart_lines where customer_id = ${fromId} and kind = 'builder'
    on conflict (customer_id, fragrance_ids) where kind = 'builder' do update set qty = cart_lines.qty + excluded.qty
  `);
  await tx.delete(cartLines).where(eq(cartLines.customerId, fromId));
  if (from) {
    await tx
      .insert(carts)
      .values({ customerId: toId, discountChoice: from.discountChoice, promoCode: from.promoCode })
      .onConflictDoUpdate({
        target: carts.customerId,
        set: {
          discountChoice: sql`coalesce(${carts.discountChoice}, excluded.discount_choice)`,
          promoCode: sql`coalesce(${carts.promoCode}, excluded.promo_code)`,
          updatedAt: now,
        },
      });
    await tx.delete(carts).where(eq(carts.customerId, fromId));
  }
}
