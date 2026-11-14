import {
  CAMPAIGN_SOURCES,
  tashkentDayStart,
  UPGRADE_RIGHT_SOURCES,
  type AcquisitionRow,
  type CampaignSource,
  type MarketingFigures,
  type MarketingReport,
  type PromoCodeReportRow,
  type ReportLink,
  type SourceRow,
  type UpgradeRightReportRow,
  type UpgradeRightSource,
} from '@lummi/contracts';
import {
  and,
  campaignLinks,
  campaignOpens,
  customers,
  eq,
  inArray,
  isNotNull,
  orders,
  promoCodes,
  promoCodeUses,
  sql,
  upgradeRights,
  type Db,
  type DbOrTx,
  type SQL,
} from '@lummi/db';
import type { AnyColumn } from 'drizzle-orm';
import { fulfilledAt, fulfilledOrder } from '../orders/fulfilled';
import {
  countedRefunds,
  deliveredIn,
  fulfilledOrdersById,
  type ReportOrder,
  type TashkentRange,
} from './report-orders';
import { isSalesRange, roundedAverage } from './sales-summary';

/**
 * The marketing reports over a range of Tashkent days (TZ §7 «Промокоды и источники», «Скидка за
 * набор»; #43, ADR 0022): the one computation behind the page and its Excel export.
 *
 * They take the sales report's orders and Refunds (`deliveredIn`, `countedRefunds`: Fulfilled
 * orders on their delivery day, Refunds on greatest(the day sent, the delivery day)) and split
 * them four ways, each row with the same figures (`MarketingFigures`):
 * - **by promo code**: the code the order took (its `promo_code_uses` row, written with the
 *   snapshot). Opens are the customers who opened one of the code's links in the range; the
 *   conversion is its orders that came through one of those links ÷ those opens, and is hidden
 *   (null) for a code with no link;
 * - **by Source**: the order's campaign link (the last one opened within N days, ADR 0022), each
 *   Source with its links; orders without one are `withoutLink`;
 * - **by acquisition**: the customer's first campaign link, for the orders they placed at or after
 *   first opening it; the rest are `withoutAcquisition`. Acquired = customers who first opened
 *   their first link in the range;
 * - **the set discount**: upgrade rights opened in the range by orders still Fulfilled, and the
 *   orders that used one (one right per order).
 *
 * A row's new customers are its customers for whom one of its orders is their first Fulfilled
 * order ever (by delivery). A refund adds to the row of its order, also when the order was
 * delivered before the range (so the Sources and the first links each add up to the sales report).
 * Every read happens in one read-only snapshot; a range that is not `isSalesRange` is a
 * `RangeError`.
 */
export async function marketingSummary(db: Db, range: TashkentRange): Promise<MarketingReport> {
  if (!isSalesRange(range)) throw new RangeError(`not a report range: ${JSON.stringify(range)}`);
  return db.transaction((tx) => summarise(tx, range), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

/** One row's running sums. */
class Tally {
  orders = 0;
  customers = new Set<number>();
  newCustomers = new Set<number>();
  items = 0;
  discount = 0;
  refunds = 0;
  /** Orders that came through one of a promo code's own links (the promo report's conversion). */
  linkOrders = 0;

  addOrder(o: ReportOrder, first: boolean) {
    this.orders += 1;
    this.customers.add(o.customerId);
    if (first) this.newCustomers.add(o.customerId);
    this.items += o.items;
    this.discount += o.discountAmount;
  }

  figures(): MarketingFigures {
    const sold = this.items - this.discount;
    return {
      orders: this.orders,
      customers: this.customers.size,
      newCustomers: this.newCustomers.size,
      itemsBeforeDiscount: this.items,
      discount: this.discount,
      refunds: this.refunds,
      net: sold - this.refunds,
      averageCheck: roundedAverage(sold, this.orders),
    };
  }
}

/** Tallies by key, made on first use. */
class Tallies<K> extends Map<K, Tally> {
  of(key: K): Tally {
    let t = this.get(key);
    if (!t) this.set(key, (t = new Tally()));
    return t;
  }
  figures(key: K): MarketingFigures {
    return (this.get(key) ?? new Tally()).figures();
  }
}

/** Customers by key. */
class Groups<K> extends Map<K, Set<number>> {
  add2(key: K, customerId: number) {
    const s = this.get(key);
    if (s) s.add(customerId);
    else this.set(key, new Set([customerId]));
  }
  count(key: K): number {
    return this.get(key)?.size ?? 0;
  }
}

/** `part ÷ whole` as a percentage with one decimal, halves up; null when `whole` is 0. */
export function percentOf(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.floor((2000 * part + whole) / (2 * whole)) / 10;
}

async function summarise(db: DbOrTx, range: TashkentRange): Promise<MarketingReport> {
  const start = tashkentDayStart(range.from).toISOString();
  const end = tashkentDayStart(range.to, 1).toISOString();
  /** An instant on a day of the range. */
  const within = (at: SQL | AnyColumn) => and(sql`${at} >= ${start}`, sql`${at} < ${end}`);

  // ---- the sales report's orders and Refunds, and the orders those Refunds name
  const sold = await deliveredIn(db, range);
  const refunded = await countedRefunds(db, range);
  const soldIds = new Set(sold.map((o) => o.id));
  const earlier = await fulfilledOrdersById(db, [
    ...new Set(refunded.map((r) => r.orderId).filter((id) => !soldIds.has(id))),
  ]);
  const order = new Map([...sold, ...earlier].map((o) => [o.id, o]));
  const orderIds = [...order.keys()];
  const customerIds = [...new Set([...order.values()].map((o) => o.customerId))];

  // the code each order took: one use per order, written with its snapshot
  const uses = orderIds.length
    ? await db
        .select({ orderId: promoCodeUses.orderId, promoCodeId: promoCodeUses.promoCodeId })
        .from(promoCodeUses)
        .where(inArray(promoCodeUses.orderId, orderIds))
    : [];
  const promoOf = new Map(uses.map((u) => [u.orderId, u.promoCodeId]));

  // each customer's first Fulfilled order ever, by delivery (the earlier id on a tie)
  const theirs = customerIds.length
    ? await db
        .select({ id: orders.id, customerId: orders.customerId, at: fulfilledAt })
        .from(orders)
        .where(and(fulfilledOrder, inArray(orders.customerId, customerIds)))
    : [];
  const firstOf = new Map<number, { id: number; at: number }>();
  for (const o of theirs) {
    const at = o.at!.getTime();
    const was = firstOf.get(o.customerId);
    if (!was || at < was.at || (at === was.at && o.id < was.id))
      firstOf.set(o.customerId, { id: o.id, at });
  }
  const isFirst = (o: ReportOrder) => firstOf.get(o.customerId)?.id === o.id;

  // every link with the promo code it prefills now
  const links = await db
    .select({
      id: campaignLinks.id,
      code: campaignLinks.code,
      source: campaignLinks.source,
      sourceLabel: campaignLinks.sourceLabel,
      promoCodeId: campaignLinks.promoCodeId,
      promoCode: promoCodes.code,
    })
    .from(campaignLinks)
    .leftJoin(promoCodes, eq(promoCodes.id, campaignLinks.promoCodeId))
    .orderBy(campaignLinks.id);
  const link = new Map(links.map((l) => [l.id, l]));
  const named = (l: (typeof links)[number]): ReportLink => ({
    id: l.id,
    code: l.code,
    source: l.source,
    sourceLabel: l.sourceLabel,
    promoCode: l.promoCode,
  });

  // who opened which link in the range: "opens" count customers (ADR 0022)
  const opened = await db
    .select({ linkId: campaignOpens.linkId, customerId: campaignOpens.customerId })
    .from(campaignOpens)
    .where(within(campaignOpens.openedAt))
    .groupBy(campaignOpens.linkId, campaignOpens.customerId);
  const openersOfLink = new Groups<number>();
  const openersOfSource = new Groups<CampaignSource>();
  const openersOfCode = new Groups<number>();
  for (const o of opened) {
    const l = link.get(o.linkId)!;
    openersOfLink.add2(l.id, o.customerId);
    openersOfSource.add2(l.source, o.customerId);
    if (l.promoCodeId !== null) openersOfCode.add2(l.promoCodeId, o.customerId);
  }

  // the customer's first link (set with their first open ever, #35) and when they first opened
  // it; a select over `customers` alone, so its row is named in full (drizzle leaves a lone
  // table's columns unqualified)
  const firstOpen = sql<Date | null>`(select min(co.opened_at) from ${campaignOpens} co where co.customer_id = "customers"."id" and co.link_id = "customers"."acquisition_link_id")`;
  const acquisitions = customerIds.length
    ? await db
        .select({
          customerId: customers.id,
          linkId: customers.acquisitionLinkId,
          at: firstOpen.mapWith(campaignOpens.openedAt),
        })
        .from(customers)
        .where(and(inArray(customers.id, customerIds), isNotNull(customers.acquisitionLinkId)))
    : [];
  const acquisitionOf = new Map(acquisitions.map((a) => [a.customerId, a]));
  const acquired = await db
    .select({ linkId: customers.acquisitionLinkId, n: sql<number>`count(*)::int` })
    .from(customers)
    .where(and(isNotNull(customers.acquisitionLinkId), within(firstOpen)))
    .groupBy(customers.acquisitionLinkId);
  const acquiredBy = new Map(acquired.map((a) => [a.linkId!, a.n]));

  // upgrade rights opened in the range by orders still Fulfilled
  const issued = await db
    .select({ source: upgradeRights.source, n: sql<number>`count(*)::int` })
    .from(upgradeRights)
    .innerJoin(orders, eq(orders.id, upgradeRights.sourceOrderId))
    .where(and(fulfilledOrder, within(upgradeRights.openedAt)))
    .groupBy(upgradeRights.source);
  const issuedBy = new Map(issued.map((i) => [i.source, i.n]));

  // ---- every order and refund into the rows it belongs to
  const byCode = new Tallies<number>();
  const bySource = new Tallies<CampaignSource>();
  const byLink = new Tallies<number>();
  const withoutLink = new Tally();
  const byFirstSource = new Tallies<CampaignSource>();
  const byFirstLink = new Tallies<number>();
  const withoutFirst = new Tally();
  const byRight = new Tallies<UpgradeRightSource>();

  const rowsOf = (o: ReportOrder): Tally[] => {
    const rows: Tally[] = [];
    const code = promoOf.get(o.id);
    if (code !== undefined) rows.push(byCode.of(code));
    const took = o.campaignLinkId === null ? undefined : link.get(o.campaignLinkId);
    if (took) rows.push(bySource.of(took.source), byLink.of(took.id));
    else rows.push(withoutLink);
    const a = acquisitionOf.get(o.customerId);
    const first = a?.at && o.createdAt >= a.at ? link.get(a.linkId!) : undefined;
    if (first) rows.push(byFirstSource.of(first.source), byFirstLink.of(first.id));
    else rows.push(withoutFirst);
    if (o.discount?.type === 'upgrade_right') rows.push(byRight.of(o.discount.source));
    return rows;
  };
  for (const o of sold) {
    for (const row of rowsOf(o)) row.addOrder(o, isFirst(o));
    // through the code's own link: the link the order took prefills this code
    const code = promoOf.get(o.id);
    const took = o.campaignLinkId === null ? undefined : link.get(o.campaignLinkId);
    if (code !== undefined && took?.promoCodeId === code) byCode.of(code).linkOrders += 1;
  }
  for (const r of refunded)
    for (const row of rowsOf(order.get(r.orderId)!)) row.refunds += r.amount;

  // ---- promo codes: any with an order, a refund or an open in the range
  const codeIds = [...new Set([...byCode.keys(), ...openersOfCode.keys()])];
  const codeText = new Map(
    (codeIds.length
      ? await db
          .select({ id: promoCodes.id, code: promoCodes.code })
          .from(promoCodes)
          .where(inArray(promoCodes.id, codeIds))
      : []
    ).map((p) => [p.id, p.code]),
  );
  const promoCodeRows: PromoCodeReportRow[] = codeIds
    .map((id) => {
      const its = links.filter((l) => l.promoCodeId === id);
      const opens = its.length ? openersOfCode.count(id) : null;
      const linkOrders = byCode.get(id)?.linkOrders ?? 0;
      return {
        promoCodeId: id,
        code: codeText.get(id)!,
        links: its.map(named),
        ...byCode.figures(id),
        opens,
        linkOrders,
        conversion: opens === null ? null : percentOf(linkOrders, opens),
      };
    })
    .sort((a, b) => b.orders - a.orders || b.net - a.net || a.code.localeCompare(b.code));

  // ---- Sources, each with its links that had anything in the range
  const active = (t: Tally | undefined) => !!t && (t.orders > 0 || t.refunds > 0);
  const byMost = <R extends MarketingFigures & { link: ReportLink }>(a: R, b: R) =>
    b.orders - a.orders || b.net - a.net || a.link.id - b.link.id;
  const sources: SourceRow[] = CAMPAIGN_SOURCES.map((source) => {
    const figures = bySource.figures(source);
    const opens = openersOfSource.count(source);
    return {
      source,
      ...figures,
      opens,
      conversion: percentOf(figures.orders, opens),
      links: links
        .filter((l) => l.source === source && (active(byLink.get(l.id)) || openersOfLink.has(l.id)))
        .map((l) => {
          const f = byLink.figures(l.id);
          const opens = openersOfLink.count(l.id);
          return { link: named(l), ...f, opens, conversion: percentOf(f.orders, opens) };
        })
        .sort((a, b) => byMost(a, b) || b.opens - a.opens),
    };
  });

  const acquisition: AcquisitionRow[] = CAMPAIGN_SOURCES.map((source) => {
    const its = links.filter((l) => l.source === source);
    return {
      source,
      acquired: its.reduce((n, l) => n + (acquiredBy.get(l.id) ?? 0), 0),
      ...byFirstSource.figures(source),
      links: its
        .filter((l) => active(byFirstLink.get(l.id)) || acquiredBy.has(l.id))
        .map((l) => ({
          link: named(l),
          acquired: acquiredBy.get(l.id) ?? 0,
          ...byFirstLink.figures(l.id),
        }))
        .sort(byMost),
    };
  });

  const upgradeRightRows: UpgradeRightReportRow[] = UPGRADE_RIGHT_SOURCES.map((source) => ({
    source,
    issued: issuedBy.get(source) ?? 0,
    ...byRight.figures(source),
  }));

  return {
    from: range.from,
    to: range.to,
    promoCodes: promoCodeRows,
    sources,
    withoutLink: withoutLink.figures(),
    acquisition,
    withoutAcquisition: withoutFirst.figures(),
    upgradeRights: upgradeRightRows,
  };
}
