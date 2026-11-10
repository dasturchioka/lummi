import type { DbOrTx, OrderRow } from '@lummi/db';
import { Injectable } from '@nestjs/common';

/**
 * ADR 0005 seam, the pair of the hold in `OrdersService.createOrder`. `transition()` calls these
 * in the transaction of the status change; a provider, so the discount tickets fill it in place
 * and tests can watch the calls. No order holds a source yet, so both do nothing for now.
 */
@Injectable()
export class DiscountSourceHooks {
  /**
   * A cancelled order, or one returned as a whole, releases the source it held: an upgrade right
   * (#38) or a birthday coupon (#30) gets its `used_by_order_id` cleared and is active again while
   * still within validity, otherwise lost; a promo-code use (#29) is voided.
   */
  async release(_tx: DbOrTx, _order: OrderRow): Promise<void> {}

  /**
   * A returned **source** order (a set, or a 10 ml bottle once approved) closes the upgrade
   * rights it opened; one already spent stays with the order that used it, no clawback (#38, #40).
   */
  async closeRightsOpenedBy(_tx: DbOrTx, _order: OrderRow): Promise<void> {}
}
