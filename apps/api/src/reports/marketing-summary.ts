import {
  CAMPAIGN_SOURCES,
  NO_PROMO_CODE,
  NO_SOURCE,
  UPGRADE_RIGHT_SOURCES,
  type AcquisitionRow,
  type CampaignSource,
  type MarketingFigures,
  type MarketingFilters,
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
} from '@lummi/db';
import { fulfilledAt, fulfilledOrder } from '../orders/fulfilled';
import {
  countedRefunds,
  deliveredAt,
  deliveredIn,
  fulfilledOrdersById,
  type ReportOrder,
} from './report-orders';
import { isReportRange, roundedAverage, within, type TashkentRange } from './report-range';

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
 * - **by acquisition**: the link that acquired the customer, their first campaign link, when they
 *   first opened it as a New customer (no order yet that was not cancelled). Customers who had
 *   ordered before are `earlierCustomers`; those who never opened a link, `withoutFirstLink`.
 *   Acquired = customers a link acquired with a first open in the range;
 * - **the set discount**: upgrade rights opened in the range by orders still Fulfilled, and the
 *   orders that used one (one right per order).
 *
 * The **filters** (TZ «источник, код») narrow the orders all four count, and their Refunds: the
 * order's Source (`none`: no campaign link) and its promo code (`none`: no code). The Source
 * filter also narrows the opens and the customers acquired to that Source's links. Rights issued
 * count when the order that opened them passes the filters.
 *
 * A row's first-time buyers are its customers for whom one of its orders is their first Fulfilled
 * order ever (by delivery). A refund adds to the row of its order, also when the order was
 * delivered before the range, so the Sources and the acquisition rows each add up to the sales
 * report (or, filtered, to the filtered orders). Every read happens in one read-only snapshot; a
 * range that is not `isReportRange` is a `RangeError`.
 */
export async function marketingSummary(
  db: Db,
  range: TashkentRange,
  filters: MarketingFilters = {},
): Promise<MarketingReport> {
  if (!isReportRange(range)) throw new RangeError(`not a report range: ${JSON.stringify(range)}`);
  return marketingSummaryOver(db, range, filters);
}

/**
 * The same computation without the report page's range guard (at most a year): for a caller that
 * counts a whole life, such as the promo list's stats (#65). The page's own limit stays.
 */
export function marketingSummaryOver(
  db: Db,
  range: TashkentRange,
  filters: MarketingFilters = {},
): Promise<MarketingReport> {
  return db.transaction((tx) => summarise(tx, range, filters), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

/** One row's running sums. */
class Tally {
  orders = 0;
  customers = new Set<number>();
  firstTimeBuyers = new Set<number>();
  items = 0;
  discount = 0;
  refunds = 0;

  addOrder(o: ReportOrder, first: boolean) {
    this.orders += 1;
    this.customers.add(o.customerId);
    if (first) this.firstTimeBuyers.add(o.customerId);
    this.items += o.items;
    this.discount += o.discountAmount;
  }

  figures(): MarketingFigures {
    const sold = this.items - this.discount;
    return {
      orders: this.orders,
      customers: this.customers.size,
      firstTimeBuyers: this.firstTimeBuyers.size,
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

/** Customers by key: opens and acquisitions count people, not taps. */
class Customers<K> extends Map<K, Set<number>> {
  addCustomer(key: K, customerId: number) {
    const s = this.get(key);
    if (s) s.add(customerId);
    else this.set(key, new Set([customerId]));
  }
  count(key: K): number {
    return this.get(key)?.size ?? 0;
  }
}

/** `part ÷ whole` as a percentage with one decimal, halves up; null when `whole` is 0. */
export function percentShare(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.floor((2000 * part + whole) / (2 * whole)) / 10;
}

async function summarise(
  db: DbOrTx,
  range: TashkentRange,
  filters: MarketingFilters,
): Promise<MarketingReport> {
  // ---- the sales report's orders and Refunds, and the orders those Refunds name
  const sold = await deliveredIn(db, range);
  const refunded = await countedRefunds(db, range);
  const soldIds = new Set(sold.map((o) => o.id));
  const earlier = await fulfilledOrdersById(db, [
    ...new Set(refunded.map((r) => r.orderId).filter((id) => !soldIds.has(id))),
  ]);
  const order = new Map([...sold, ...earlier].map((o) => [o.id, o]));

  // upgrade rights opened in the range by orders still Fulfilled, with what the filters read
  const opened = await db
    .select({
      source: upgradeRights.source,
      orderId: orders.id,
      campaignLinkId: orders.campaignLinkId,
      n: sql<number>`count(*)::int`,
    })
    .from(upgradeRights)
    .innerJoin(orders, eq(orders.id, upgradeRights.sourceOrderId))
    .where(and(fulfilledOrder, within(upgradeRights.openedAt, range)))
    .groupBy(upgradeRights.source, orders.id);

  // the code each order took: one use per order, written with its snapshot
  const orderIds = [...new Set([...order.keys(), ...opened.map((r) => r.orderId)])];
  const uses = orderIds.length
    ? await db
        .select({ orderId: promoCodeUses.orderId, promoCodeId: promoCodeUses.promoCodeId })
        .from(promoCodeUses)
        .where(inArray(promoCodeUses.orderId, orderIds))
    : [];
  const promoOf = new Map(uses.map((u) => [u.orderId, u.promoCodeId]));

  // every link with the promo code it prefills now, and the codes by id
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
  const codeIds = [...new Set([...promoOf.values(), ...links.flatMap((l) => l.promoCodeId ?? [])])];
  const codeText = new Map(
    (codeIds.length
      ? await db
          .select({ id: promoCodes.id, code: promoCodes.code })
          .from(promoCodes)
          .where(inArray(promoCodes.id, codeIds))
      : []
    ).map((p) => [p.id, p.code]),
  );

  // ---- the filters: which orders count, which links' opens and acquisitions count
  const tookLink = (o: { campaignLinkId: number | null }) =>
    o.campaignLinkId === null ? undefined : link.get(o.campaignLinkId);
  const passes = (o: { id: number; campaignLinkId: number | null }) => {
    const took = tookLink(o);
    if (filters.source === NO_SOURCE ? took : filters.source && took?.source !== filters.source)
      return false;
    const code = promoOf.get(o.id);
    if (filters.code === NO_PROMO_CODE) return code === undefined;
    return !filters.code || (code !== undefined && codeText.get(code) === filters.code);
  };
  const linkCounts = (l: { source: CampaignSource }) =>
    !filters.source || (filters.source !== NO_SOURCE && l.source === filters.source);
  const counted = sold.filter(passes);
  const countedRefundsOf = refunded.filter((r) => passes(order.get(r.orderId)!));
  const customerIds = [
    ...new Set(
      [...counted, ...countedRefundsOf.map((r) => order.get(r.orderId)!)].map((o) => o.customerId),
    ),
  ];

  // each customer's first Fulfilled order ever, by delivery (the earlier id on a tie)
  const theirs = customerIds.length
    ? await db
        .select({ id: orders.id, customerId: orders.customerId, at: fulfilledAt })
        .from(orders)
        .where(and(fulfilledOrder, inArray(orders.customerId, customerIds)))
    : [];
  const firstOf = new Map<number, { id: number; at: number }>();
  for (const o of theirs) {
    const at = deliveredAt(o.at, o.id).getTime();
    const was = firstOf.get(o.customerId);
    if (!was || at < was.at || (at === was.at && o.id < was.id))
      firstOf.set(o.customerId, { id: o.id, at });
  }
  const isFirst = (o: ReportOrder) => firstOf.get(o.customerId)?.id === o.id;

  // who opened which link in the range: "opens" count customers (ADR 0022)
  const openedLinks = await db
    .select({ linkId: campaignOpens.linkId, customerId: campaignOpens.customerId })
    .from(campaignOpens)
    .where(within(campaignOpens.openedAt, range))
    .groupBy(campaignOpens.linkId, campaignOpens.customerId);
  const openersOfLink = new Customers<number>();
  const openersOfSource = new Customers<CampaignSource>();
  const openersOfCode = new Customers<number>();
  for (const o of openedLinks) {
    const l = link.get(o.linkId)!;
    if (!linkCounts(l)) continue;
    openersOfLink.addCustomer(l.id, o.customerId);
    openersOfSource.addCustomer(l.source, o.customerId);
    if (l.promoCodeId !== null) openersOfCode.addCustomer(l.promoCodeId, o.customerId);
  }

  // The customer's first link (set with their first open ever, #35), when they first opened it,
  // and whether they were still a New customer then: no order before it that was not cancelled.
  // A select over `customers` alone, so its row is named in full (drizzle leaves a lone table's
  // columns unqualified).
  const firstOpen = sql<Date | null>`(select min(co.opened_at) from ${campaignOpens} co where co.customer_id = "customers"."id" and co.link_id = "customers"."acquisition_link_id")`;
  const newThen = sql<boolean>`not exists (select 1 from ${orders} eo where eo.customer_id = "customers"."id" and eo.status <> 'cancelled' and eo.created_at < ${firstOpen})`;
  const acquisitions = customerIds.length
    ? await db
        .select({ customerId: customers.id, linkId: customers.acquisitionLinkId, newThen })
        .from(customers)
        .where(and(inArray(customers.id, customerIds), isNotNull(customers.acquisitionLinkId)))
    : [];
  const acquisitionOf = new Map(acquisitions.map((a) => [a.customerId, a]));
  const acquired = await db
    .select({ linkId: customers.acquisitionLinkId, n: sql<number>`count(*)::int` })
    .from(customers)
    .where(and(isNotNull(customers.acquisitionLinkId), within(firstOpen, range), newThen))
    .groupBy(customers.acquisitionLinkId);
  const acquiredBy = new Map(
    acquired.filter((a) => linkCounts(link.get(a.linkId!)!)).map((a) => [a.linkId!, a.n]),
  );

  const issuedBy = new Map<UpgradeRightSource, number>();
  for (const r of opened)
    if (passes({ id: r.orderId, campaignLinkId: r.campaignLinkId }))
      issuedBy.set(r.source, (issuedBy.get(r.source) ?? 0) + r.n);

  // ---- every counted order and refund into the rows it belongs to
  const byCode = new Tallies<number>();
  /** Orders that came through one of their promo code's own links (the conversion). */
  const linkOrdersOf = new Map<number, number>();
  const bySource = new Tallies<CampaignSource>();
  const byLink = new Tallies<number>();
  const withoutLink = new Tally();
  const byFirstSource = new Tallies<CampaignSource>();
  const byFirstLink = new Tallies<number>();
  const earlierCustomers = new Tally();
  const withoutFirstLink = new Tally();
  const byRight = new Tallies<UpgradeRightSource>();

  /**
   * The rows an order counts in, and its code when it came through one of that code's own links
   * (the link it took prefills the code: the promo report's conversion).
   */
  const placeOf = (o: ReportOrder): { rows: Tally[]; throughOwnLink?: number } => {
    const rows: Tally[] = [];
    const code = promoOf.get(o.id);
    if (code !== undefined) rows.push(byCode.of(code));
    const took = tookLink(o);
    if (took) rows.push(bySource.of(took.source), byLink.of(took.id));
    else rows.push(withoutLink);
    const a = acquisitionOf.get(o.customerId);
    const first = a?.newThen ? link.get(a.linkId!) : undefined;
    if (first) rows.push(byFirstSource.of(first.source), byFirstLink.of(first.id));
    else rows.push(a ? earlierCustomers : withoutFirstLink);
    if (o.discount?.type === 'upgrade_right') rows.push(byRight.of(o.discount.source));
    return {
      rows,
      throughOwnLink: code !== undefined && took?.promoCodeId === code ? code : undefined,
    };
  };
  for (const o of counted) {
    const { rows, throughOwnLink } = placeOf(o);
    for (const row of rows) row.addOrder(o, isFirst(o));
    if (throughOwnLink !== undefined)
      linkOrdersOf.set(throughOwnLink, (linkOrdersOf.get(throughOwnLink) ?? 0) + 1);
  }
  for (const r of countedRefundsOf)
    for (const row of placeOf(order.get(r.orderId)!).rows) row.refunds += r.amount;

  // ---- promo codes: any with an order, a refund or an open in the range (the code filter's own)
  const promoCodeRows: PromoCodeReportRow[] = [
    ...new Set([...byCode.keys(), ...openersOfCode.keys()]),
  ]
    .filter((id) =>
      filters.code === NO_PROMO_CODE ? false : !filters.code || codeText.get(id) === filters.code,
    )
    .map((id) => {
      const its = links.filter((l) => l.promoCodeId === id && linkCounts(l));
      const opens = its.length ? openersOfCode.count(id) : null;
      const linkOrders = linkOrdersOf.get(id) ?? 0;
      return {
        promoCodeId: id,
        code: codeText.get(id)!,
        links: its.map(named),
        ...byCode.figures(id),
        opens,
        linkOrders,
        conversion: opens === null ? null : percentShare(linkOrders, opens),
      };
    })
    .sort((a, b) => b.orders - a.orders || b.net - a.net || a.code.localeCompare(b.code));

  // ---- Sources (the filter's own), each with its links that had anything in the range
  const active = (t: Tally | undefined) => !!t && (t.orders > 0 || t.refunds > 0);
  const byMost = <R extends MarketingFigures & { link: ReportLink }>(a: R, b: R) =>
    b.orders - a.orders || b.net - a.net || a.link.id - b.link.id;
  const sources: SourceRow[] = CAMPAIGN_SOURCES.filter((source) => linkCounts({ source })).map(
    (source) => {
      const figures = bySource.figures(source);
      const opens = openersOfSource.count(source);
      return {
        source,
        ...figures,
        opens,
        conversion: percentShare(figures.orders, opens),
        links: links
          .filter(
            (l) => l.source === source && (active(byLink.get(l.id)) || openersOfLink.has(l.id)),
          )
          .map((l) => {
            const f = byLink.figures(l.id);
            const opens = openersOfLink.count(l.id);
            return { link: named(l), ...f, opens, conversion: percentShare(f.orders, opens) };
          })
          .sort((a, b) => byMost(a, b) || b.opens - a.opens),
      };
    },
  );

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
    filters: { source: filters.source ?? null, code: filters.code ?? null },
    promoCodes: promoCodeRows,
    sources,
    withoutLink: withoutLink.figures(),
    acquisition,
    earlierCustomers: earlierCustomers.figures(),
    withoutFirstLink: withoutFirstLink.figures(),
    upgradeRights: upgradeRightRows,
  };
}
