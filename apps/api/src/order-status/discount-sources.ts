import type { DbOrTx, OrderLineRow, OrderRow } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { voidPromoUse } from '../promo/promo-codes';
import { EDGES } from '../tokens';
import { closeUpgradeRightsOpenedBy, openUpgradeRights } from '../upgrade-rights/upgrade-rights';

/**
 * ADR 0005 seam, the pair of the hold in `OrdersService.createOrder`. `transition()` calls these
 * in the transaction of the status change; a provider, so the discount tickets fill it in place
 * and tests can watch the calls. Promo-code uses (#29) are released; rights and coupons come
 * with their tickets. Delivery opens upgrade rights and a return closes them (#38, ADR 0003).
 */
@Injectable()
export class DiscountSourceHooks {
  constructor(@Inject(EDGES) private readonly edges: Edges) {}

  /**
   * A cancelled order, or one returned as a whole, releases the source it held: an upgrade right
   * (#38) or a birthday coupon (#30) gets its `used_by_order_id` cleared and is active again while
   * still within validity, otherwise lost; a promo-code use (#29) is voided.
   */
  async release(tx: DbOrTx, order: OrderRow): Promise<void> {
    await voidPromoUse(tx, order.id, this.edges.clock.now());
  }

  /** «Доставлен»: the order's sets (and single 10 ml bottles, once switched on) open their upgrade rights. */
  async openRights(tx: DbOrTx, order: OrderRow, lines: readonly OrderLineRow[]): Promise<void> {
    await openUpgradeRights(tx, order, lines, this.edges.clock.now());
  }

  /**
   * A returned **source** order (a set, or a 10 ml bottle once approved) closes the upgrade
   * rights it opened; one already spent stays with the order that used it, no clawback (#38, #40).
   */
  async closeRightsOpenedBy(tx: DbOrTx, order: OrderRow): Promise<void> {
    await closeUpgradeRightsOpenedBy(tx, order.id, this.edges.clock.now());
  }
}
