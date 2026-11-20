import type { DbOrTx, OrderLineRow, OrderRow, UpgradeRightRow } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { releaseEntitlements } from '../entitlements/entitlements';
import { voidPromoUse } from '../promo/promo-codes';
import { EDGES } from '../tokens';
import { closeUpgradeRightsOpenedBy, openUpgradeRights } from '../upgrade-rights/upgrade-rights';

/**
 * What an order's status moves do to its discount sources (ADR 0003, 0005), the pair of the hold
 * in `OrdersService.createOrder`: a cancel or return releases what the order held (promo-code uses,
 * #29, are voided; entitlements, the birthday coupon #30 and the upgrade right #38, go back while
 * within validity), «Доставлен» opens the upgrade rights the order earns, and a return of their
 * source order closes them. `transition()` calls these in the transaction of the status change; a
 * provider, so tests can watch the calls.
 */
@Injectable()
export class DiscountSourceHooks {
  constructor(@Inject(EDGES) private readonly edges: Edges) {}

  /**
   * A cancelled order, or one returned as a whole, releases the source it held: an upgrade right
   * (#38) or a birthday coupon (#30) gets its `used_by_order_id` cleared and is active again while
   * still within validity; past it, it is lost and keeps the link. A promo-code use (#29) is voided.
   */
  async release(tx: DbOrTx, order: OrderRow): Promise<void> {
    const now = this.edges.clock.now();
    await voidPromoUse(tx, order.id, now);
    await releaseEntitlements(tx, order.id, now);
  }

  /** «Доставлен»: the order's sets (and single 10 ml bottles, once switched on) open their upgrade rights. */
  async openRights(
    tx: DbOrTx,
    order: OrderRow,
    lines: readonly OrderLineRow[],
  ): Promise<UpgradeRightRow[]> {
    return openUpgradeRights(tx, order, lines, this.edges.clock.now());
  }

  /**
   * A returned **source** order (a set, or a 10 ml bottle once approved) closes the upgrade
   * rights it opened; one already spent stays with the order that used it, no clawback (#38, #40).
   */
  async closeRightsOpenedBy(tx: DbOrTx, order: OrderRow): Promise<void> {
    await closeUpgradeRightsOpenedBy(tx, order.id, this.edges.clock.now());
  }
}
