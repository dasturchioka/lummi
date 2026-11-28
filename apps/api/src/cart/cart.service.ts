import {
  CART_MAX_QTY,
  orderRepeatable,
  normalizePromoCode,
  type CartDto,
  type CartLineDto,
  type CartSuggestionDto,
  type RepeatResultDto,
  type RepeatShortReason,
} from '@lummi/contracts';
import { FIVE_ML_SET_KEY, MAIN_SET_KEY } from '@lummi/contracts/constants';
import {
  and,
  asc,
  cartLines,
  carts,
  eq,
  fragrances,
  gte,
  notInArray,
  orderLines,
  orders,
  sellableVolume,
  sql,
  volumes,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { CatalogService, readLiquidStock } from '../catalog/catalog.service';
import type { Edges } from '../edges';
import {
  discountOptionsOf,
  entitlementWaitingBehindCode,
  lapsedDiscountOf,
} from '../entitlements/entitlements';
import {
  activeMarkdown,
  volumePrice,
  type DiscountChoice,
  type Entitlement,
} from '../pricing/quote';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import {
  builderAvailable,
  findDiscoverySet,
  judgeBuilderPick,
  tenMlOf,
  withState,
} from '../sets/sets';
import {
  loadCartQuote,
  loadQuote,
  readCartLines,
  appliedPromoGift,
  toLineDto,
  type BuilderLineView,
  type StoredLine,
} from './load-cart';

export type AddOutcome = 'ok' | 'not_found' | 'sold_out';
export type RepeatOutcome =
  { kind: 'done'; result: RepeatResultDto } | { kind: 'not_found' } | { kind: 'not_repeatable' };
export type ChooseOutcome = 'ok' | 'unavailable';
export type ApplyCodeOutcome =
  { kind: 'ok' } | { kind: 'too_many_attempts'; retryAfterSeconds: number };
export type AddSetOutcome =
  | { result: 'ok' }
  | { result: 'sold_out' | 'not_found' | 'invalid' }
  | { result: 'unavailable'; slugs: string[] };

/** The customer's server-side cart (spec Changes 2026-11-10). Money comes only from `quote()`. */
@Injectable()
export class CartService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  /**
   * The cart as it is now: lines capped at available, a fresh quote, suggestions. A stored discount
   * choice the quote found stale (used, ended, no longer discounting the cart) is dropped here once
   * the quote has said so (#39): the cart reports the fallback once, then simply picks by itself.
   * A «Не применять» with nothing left to decline is dropped here too, without a word.
   */
  async get(customerId: number, tx: DbOrTx = this.db): Promise<CartDto> {
    const now = this.edges.clock.now();
    const {
      lines,
      quote: q,
      cartState,
      city,
      entitlements,
      promoCodeId,
      promoGift,
    } = await loadCartQuote(tx, now, customerId);
    const choice = cartState?.discountChoice ?? null;
    if (choice && (q.staleChoice || declinesNothing(choice, entitlements, promoCodeId)))
      // only the choice this quote judged: a switch made meanwhile stays
      await tx
        .update(carts)
        .set({ discountChoice: null })
        .where(
          and(
            eq(carts.customerId, customerId),
            sql`${carts.discountChoice} = ${JSON.stringify(choice)}::jsonb`,
          ),
        );
    const open = q.itemsSubtotal > 0 && q.amountToFreeDelivery > 0;
    return {
      lines: lines.map((l): CartLineDto => ({ id: l.lineId, ...toLineDto(l) })),
      quote: q,
      count: lines.filter((l) => !l.soldOut).reduce((n, l) => n + l.qty, 0),
      deliveryCity: city,
      freeDeliveryProgress: progress(q),
      suggestions: open
        ? await this.suggestions(
            tx,
            lines.flatMap((l) => (l.kind === 'volume' ? [l.volumeId] : [])),
            q.amountToFreeDelivery,
            now,
          )
        : [],
      promoCode: cartState?.promoCode ?? null,
      promoGift: appliedPromoGift(q, promoGift),
      discountOptions: discountOptionsOf(q, entitlements),
      lapsedDiscount:
        q.staleChoice && choice ? await lapsedDiscountOf(tx, customerId, choice) : null,
      entitlementWaiting: entitlementWaitingBehindCode(q, entitlements),
    };
  }

  /**
   * Available 10 ml bottles not in the cart whose price alone closes the gap, so «Подойдёт любой
   * аромат 10 мл» is true. Ranked by the catalog's top-sellers order (`CatalogService`, the one
   * definition). The price test goes through `activeMarkdown` (one markdown rule); SQL pre-filters
   * on the regular price, which a markdown can only lower.
   */
  private async suggestions(
    tx: DbOrTx,
    inCart: number[],
    gap: number,
    now: Date,
  ): Promise<CartSuggestionDto[]> {
    const { 'cart.suggestionsLimit': limit } = await readSettings(tx, ['cart.suggestionsLimit']);
    if (limit === 0) return [];
    const [rank, found] = await Promise.all([
      this.catalog.topSellersOrder(tx),
      tx
        .select({
          fragranceId: fragrances.id,
          volumeId: volumes.id,
          slug: fragrances.slug,
          name: fragrances.name,
          brand: fragrances.originalBrand,
          photo: volumes.photoHash,
          price: volumes.price,
          salePrice: volumes.salePrice,
          saleEndsAt: volumes.saleEndsAt,
        })
        .from(volumes)
        .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
        .where(
          and(
            eq(volumes.ml, 10),
            eq(fragrances.hidden, false),
            gte(volumes.price, gap),
            inCart.length > 0 ? notInArray(volumes.id, inCart) : undefined,
          ),
        ),
    ]);
    const position = new Map(rank.map((id, i) => [id, i]));
    const at = (id: number) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
    const rows = found.sort((a, b) => at(a.fragranceId) - at(b.fragranceId));
    const stock = await readLiquidStock(
      tx,
      rows.map((r) => r.fragranceId),
    );
    const out: CartSuggestionDto[] = [];
    for (const r of rows) {
      if (stock.bottles(r.fragranceId, 10) === 0) continue;
      const price = activeMarkdown(volumePrice(r), now) ?? r.price;
      if (price < gap) continue;
      out.push({ slug: r.slug, name: r.name, brand: r.brand, ml: 10, photo: r.photo, price });
      if (out.length === limit) break;
    }
    return out;
  }

  /** Adds a volume; the total on the line never passes what is available. */
  async add(customerId: number, slug: string, ml: number, qty: number): Promise<AddOutcome> {
    return this.db.transaction(async (tx) => {
      const [v] = await tx
        .select({ id: volumes.id, fragranceId: volumes.fragranceId })
        .from(volumes)
        .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
        .where(
          and(
            eq(fragrances.slug, slug),
            eq(fragrances.hidden, false),
            eq(volumes.ml, ml),
            // a 5 ml bottle is never sold alone (ADR 0042)
            sellableVolume(),
          ),
        );
      if (!v) return 'not_found' as const;
      // what the line may grow to: the bottles the free concentrate fills (the cart's read weighs
      // its other lines of the same fragrance, ADR 0043)
      const left = (await readLiquidStock(tx, [v.fragranceId])).bottles(v.fragranceId, ml);
      if (left === 0) return 'sold_out' as const;
      await this.touch(tx, customerId);
      await this.grow(tx, customerId, { kind: 'volume', volumeId: v.id }, qty, left);
      return 'ok' as const;
    });
  }

  /** Adds a Discovery set; the total on the line never passes the set's own stock. A hidden or unknown set is not found. */
  async addDiscovery(customerId: number, key: string, qty: number): Promise<AddSetOutcome> {
    return this.db.transaction(async (tx) => {
      const row = await findDiscoverySet(tx, key);
      if (!row || row.hidden) return { result: 'not_found' } as const;
      const { available: left } = await withState(tx, row);
      if (left === 0) return { result: 'sold_out' } as const;
      await this.touch(tx, customerId);
      await this.grow(tx, customerId, { kind: 'discovery_set', setKey: key }, qty, left);
      return { result: 'ok' } as const;
    });
  }

  /**
   * Adds a builder set: exactly five different fragrances, each with a 10 ml available (ADR 0009).
   * The same five add up on one line; the quantity is capped by the scarcest 10 ml.
   */
  async addBuilder(customerId: number, slugs: string[], qty: number): Promise<AddSetOutcome> {
    return this.db.transaction(async (tx) => {
      const picked = judgeBuilderPick(slugs, await tenMlOf(tx, { slugs }));
      if (!picked.ok) {
        return picked.reason === 'unavailable'
          ? ({ result: 'unavailable', slugs: picked.slugs } as const)
          : ({ result: picked.reason } as const);
      }
      const left = builderAvailable(picked.tenMl);
      if (left === 0) return { result: 'sold_out' } as const;
      const fragranceIds = picked.tenMl.map((t) => t.fragranceId).sort((a, b) => a - b);
      await this.touch(tx, customerId);
      await this.grow(tx, customerId, { kind: 'builder_set', fragranceIds }, qty, left);
      return { result: 'ok' } as const;
    });
  }

  /**
   * «Повторить заказ» (spec Changes 2026-11-07 cart, 2026-11-11): a delivered or cancelled order's
   * lines go into the cart at today's prices (the cart re-quotes them). Each old line is weighed
   * after the cart's own lines, through the same quote that judges the cart, so it takes only what
   * they leave: capped at available and at the per-line ceiling, skipped when nothing is left (a
   * builder set needs all five 10 ml). A line already in the cart (the same volume, the Discovery
   * set, the same five) grows by what was added. Each line short of what was ordered says why.
   */
  async repeat(customerId: number, number: number): Promise<RepeatOutcome> {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(and(eq(orders.customerId, customerId), eq(orders.number, number)));
      if (!order) return { kind: 'not_found' } as const;
      if (!orderRepeatable(order.status)) return { kind: 'not_repeatable' } as const;
      const old = await tx
        .select()
        .from(orderLines)
        // a gift code's free line came with that code (ADR 0039), a gift sample with the first
        // order (ADR 0042): neither is bought again
        .where(
          and(
            eq(orderLines.orderId, order.id),
            eq(orderLines.promoGift, false),
            eq(orderLines.giftSample, false),
          ),
        )
        .orderBy(asc(orderLines.position));
      // the cart row first, like every cart write: a concurrent add or change waits for this one
      await this.touch(tx, customerId);
      const cart = await readCartLines(tx, customerId);

      // The old lines after every cart line (ids above the cart's), as the cart would hold them.
      const after = Math.max(0, ...cart.map((l) => l.lineId)) + 1;
      const wanted = old.map((l, i): StoredLine => {
        const line = {
          lineId: after + i,
          qty: l.qty,
          volumeId: null,
          fragranceIds: null,
          setKey: null,
        };
        if (l.kind === 'volume') return { ...line, kind: 'volume', volumeId: l.volumeId };
        if (l.kind === 'discovery_set')
          return {
            ...line,
            kind: 'discovery_set',
            // a line from before the keys carried only its vial ml (ADR 0044)
            setKey: l.setKey ?? (l.ml === 5 ? FIVE_ML_SET_KEY : MAIN_SET_KEY),
          };
        const ids = (l.setComposition ?? []).map((f) => f.fragranceId).sort((a, b) => a - b);
        return { ...line, kind: 'builder_set', fragranceIds: ids };
      });
      const { lines: views } = await loadQuote(tx, this.edges.clock.now(), customerId, {
        kind: 'lines',
        lines: [...cart, ...wanted],
      });
      const viewOf = new Map(views.map((v) => [v.lineId, v]));

      const result: RepeatResultDto['lines'] = [];
      for (const [i, l] of old.entries()) {
        const w = wanted[i]!;
        const v = viewOf.get(w.lineId);
        // what stock leaves for it, and what the line it joins may still take (99 at most)
        const byStock = !v || v.soldOut ? 0 : Math.min(l.qty, v.available);
        const room = CART_MAX_QTY - (cart.find((c) => sameLine(c, w))?.qty ?? 0);
        const added = Math.max(0, Math.min(byStock, room));
        if (added > 0) await this.grow(tx, customerId, w, added);
        const reason: RepeatShortReason | null =
          added === l.qty
            ? null
            : room < byStock
              ? 'max_qty'
              : added > 0
                ? 'capped'
                : l.kind === 'builder_set'
                  ? 'set_incomplete'
                  : 'sold_out';
        result.push({
          kind: l.kind,
          name: { ru: l.nameRu, uz: l.nameUz },
          brand: l.brand,
          ml: l.ml,
          ordered: l.qty,
          added,
          reason,
          missing:
            reason === 'set_incomplete' && v?.kind === 'builder_set'
              ? missingTenMl(v, l.setComposition ?? [])
              : [],
        });
      }
      // units, counted as the order's «Товары (N)»
      const sum = (n: (r: (typeof result)[number]) => number) =>
        result.reduce((total, r) => total + n(r), 0);
      return {
        kind: 'done',
        result: { lines: result, added: sum((r) => r.added), of: sum((r) => r.ordered) },
      } as const;
    });
  }

  /**
   * The one way a line grows: adds `qty` to the cart line holding this volume, the Discovery set or
   * these five (or makes it), never past `left` (what is available, when the caller judged it) nor
   * the per-line ceiling. The caller has touched the cart row first.
   */
  private async grow(
    tx: DbOrTx,
    customerId: number,
    line:
      | { kind: 'volume'; volumeId: number | null }
      | { kind: 'discovery_set'; setKey: string | null }
      | { kind: 'builder_set'; fragranceIds: number[] | null },
    qty: number,
    left: number = CART_MAX_QTY,
  ) {
    const cap = Math.min(left, CART_MAX_QTY);
    const values = { customerId, qty: Math.min(qty, cap) };
    const set = { qty: sql`least(${cartLines.qty} + ${qty}, ${cap})` };
    if (line.kind === 'volume')
      await tx
        .insert(cartLines)
        .values({ ...values, volumeId: line.volumeId })
        .onConflictDoUpdate({ target: [cartLines.customerId, cartLines.volumeId], set });
    else if (line.kind === 'discovery_set')
      await tx
        .insert(cartLines)
        .values({ ...values, kind: 'discovery_set', setKey: line.setKey })
        .onConflictDoUpdate({
          target: [cartLines.customerId, cartLines.setKey],
          targetWhere: sql`kind = 'discovery_set'`,
          set,
        });
    else
      await tx
        .insert(cartLines)
        .values({ ...values, kind: 'builder_set', fragranceIds: line.fragranceIds })
        .onConflictDoUpdate({
          target: [cartLines.customerId, cartLines.fragranceIds],
          targetWhere: sql`kind = 'builder_set'`,
          set,
        });
  }

  /** Sets a quantity, capped at available; false when the line is not this customer's. */
  async setQuantity(customerId: number, lineId: number, qty: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // the cart row before the line, as every cart write takes them, so none deadlocks another
      await this.touch(tx, customerId);
      const { lines } = await loadCartQuote(tx, this.edges.clock.now(), customerId);
      const line = lines.find((l) => l.lineId === lineId);
      if (!line) return false;
      // a sold-out line keeps what the customer asked for; restocking brings it back
      if (line.available > 0) {
        await tx
          .update(cartLines)
          .set({ qty: Math.min(qty, line.available, CART_MAX_QTY) })
          .where(eq(cartLines.id, lineId));
      }
      return true;
    });
  }

  /**
   * Removes a line. The discount choice belongs to the lines: once the last one is gone it is moot
   * (#39), and the next cart picks by itself again. The cart row is taken first, as every cart
   * write and `createOrder` take it (the row, then its lines): the other way round, a checkout of
   * this cart and this delete would wait on each other.
   */
  async remove(customerId: number, lineId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.touch(tx, customerId);
      await tx
        .delete(cartLines)
        .where(and(eq(cartLines.id, lineId), eq(cartLines.customerId, customerId)));
      await tx
        .update(carts)
        .set({ discountChoice: null })
        .where(
          and(
            eq(carts.customerId, customerId),
            sql`not exists (select 1 from ${cartLines} where ${cartLines.customerId} = ${customerId})`,
          ),
        );
    });
  }

  /**
   * The shopper's tap on the discount switch (#39, ADR 0002), judged by the cart's own quote with
   * the cart row locked: only what the cart offers now is stored, and every later quote re-judges
   * it. Choosing the entered code stores no choice, since a typed code is applied by itself (a code
   * that then stops applying says why in its own field, not as a stale choice). «Не применять» is
   * stored while there is something to keep for later; with nothing to decline it is moot and
   * nothing is stored, so a coupon that arrives later still applies by itself.
   */
  async chooseDiscount(customerId: number, choice: DiscountChoice): Promise<ChooseOutcome> {
    return this.db.transaction(async (tx) => {
      await this.touch(tx, customerId);
      const { quote: q } = await loadCartQuote(tx, this.edges.clock.now(), customerId);
      const offered = [q.discount, ...q.alternatives.map((a) => a.discount)];
      let stored: DiscountChoice | null;
      if (choice.type === 'none') stored = offered.some((d) => d !== null) ? choice : null;
      else if (choice.type === 'promo_code') {
        if (!offered.some((d) => d?.type === 'promo_code')) return 'unavailable';
        stored = null;
      } else {
        const held = offered.some((d) => d?.type === choice.type && d.id === choice.id);
        if (!held) return 'unavailable';
        stored = { type: choice.type, id: choice.id };
      }
      await tx
        .update(carts)
        .set({ discountChoice: stored })
        .where(eq(carts.customerId, customerId));
      return 'ok';
    });
  }

  /**
   * Takes the entered code out of the cart, and a choice of that code (ADR 0002). A choice of an
   * entitlement or «Не применять» stays (#39): it was made against the code, not for it. Setting a
   * code goes only through `applyPromoCode`, which counts the attempt.
   */
  async clearPromoCode(customerId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.touch(tx, customerId);
      await tx
        .update(carts)
        .set({
          promoCode: null,
          discountChoice: sql`case when ${carts.discountChoice}->>'type' = 'promo_code' then null else ${carts.discountChoice} end`,
        })
        .where(eq(carts.customerId, customerId));
    });
  }

  /**
   * A code the customer typed (ticket #29). Codes are guessable, so each customer may type
   * `promo.attemptLimit` of them per `promo.attemptWindowSeconds` (a fixed window from the first);
   * past that the stored code stays as it was. Whatever the code, it is stored and the quote says
   * whether it applies.
   */
  async applyPromoCode(
    customerId: number,
    code: string,
    opts: { countAttempt?: boolean } = {},
  ): Promise<ApplyCodeOutcome> {
    const count = opts.countAttempt ?? true;
    return this.db.transaction(async (tx) => {
      await this.touch(tx, customerId);
      const w = await this.attemptWindow(tx, customerId);
      if (count && w.retryAfterSeconds !== null)
        return { kind: 'too_many_attempts', retryAfterSeconds: w.retryAfterSeconds };
      await tx
        .update(carts)
        .set({
          promoCode: normalizePromoCode(code),
          discountChoice: null,
          // a code a campaign link supplied is not a guess: it neither counts nor starts the window
          ...(count ? { promoAttempts: w.attempts + 1, promoAttemptsSince: w.since } : {}),
        })
        .where(eq(carts.customerId, customerId));
      return { kind: 'ok' };
    });
  }

  /**
   * Seconds until the customer may guess again, or null while they may. Reading does not spend an
   * attempt. A campaign open asks this first, so past the budget even a real link code is refused
   * and the answer is no oracle for promo codes (ticket #35).
   */
  async guessWait(customerId: number): Promise<number | null> {
    return this.db.transaction(async (tx) => {
      await this.touch(tx, customerId);
      return (await this.attemptWindow(tx, customerId)).retryAfterSeconds;
    });
  }

  /** A guess that found nothing (a campaign code that does not exist) costs an attempt, like a refused code. */
  async spendGuess(customerId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.touch(tx, customerId);
      const w = await this.attemptWindow(tx, customerId);
      await tx
        .update(carts)
        .set({ promoAttempts: w.attempts + 1, promoAttemptsSince: w.since })
        .where(eq(carts.customerId, customerId));
    });
  }

  /**
   * The customer's typed-guess window (`promo.attemptLimit` per `promo.attemptWindowSeconds`, a
   * fixed window from the first), with the cart row locked. `attempts` and `since` are what to
   * store after one more guess; `retryAfterSeconds` is set while the budget is spent.
   */
  private async attemptWindow(tx: DbOrTx, customerId: number) {
    const [row] = await tx
      .select({ attempts: carts.promoAttempts, since: carts.promoAttemptsSince })
      .from(carts)
      .where(eq(carts.customerId, customerId))
      .for('update');
    const s = await readSettings(tx, ['promo.attemptLimit', 'promo.attemptWindowSeconds']);
    const now = this.edges.clock.now();
    const windowMs = s['promo.attemptWindowSeconds'] * 1000;
    const stored = row?.since ?? null;
    const fresh = stored === null || now.getTime() - stored.getTime() >= windowMs;
    const attempts = fresh ? 0 : (row?.attempts ?? 0);
    const spent = !fresh && attempts >= s['promo.attemptLimit'];
    return {
      attempts,
      since: fresh ? now : stored,
      retryAfterSeconds: spent
        ? Math.max(1, Math.ceil((stored.getTime() + windowMs - now.getTime()) / 1000))
        : null,
    };
  }

  /** Makes sure the customer's cart row exists. */
  private async touch(tx: DbOrTx, customerId: number): Promise<void> {
    await tx
      .insert(carts)
      .values({ customerId })
      .onConflictDoUpdate({ target: carts.customerId, set: { updatedAt: this.edges.clock.now() } });
  }
}

/**
 * «Не применять» with nothing left to decline is moot (#39): the customer holds no entitlement
 * (unexpired, unused, not closed) and no entered code the shop accepts, so a right or coupon that
 * comes later should apply by itself. Judged by what they hold, not by what discounts these lines:
 * a line sold out for a moment does not end the shopper's choice.
 */
function declinesNothing(
  choice: DiscountChoice,
  held: readonly Entitlement[],
  acceptedCodeId: number | null,
): boolean {
  return choice.type === 'none' && held.length === 0 && acceptedCodeId === null;
}

/** The Sage thread's fill, whole percent: 100 once reached (or with no threshold), never 100 before. */
function progress(q: {
  itemsSubtotal: number;
  amountToFreeDelivery: number;
  thresholdBaseAmount: number;
  freeDeliveryThreshold: number;
}): number {
  if (q.itemsSubtotal === 0) return 0;
  if (q.amountToFreeDelivery === 0 || q.freeDeliveryThreshold === 0) return 100;
  return Math.min(99, Math.floor((q.thresholdBaseAmount * 100) / q.freeDeliveryThreshold));
}

/** Two stored lines hold the same thing: the same volume, the same Discovery set, or the same five. */
function sameLine(a: StoredLine, b: StoredLine): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'volume') return a.volumeId === b.volumeId;
  if (a.kind === 'discovery_set') return a.setKey === b.setKey;
  return (a.fragranceIds ?? []).join(',') === (b.fragranceIds ?? []).join(',');
}

/**
 * The fragrances of a builder set whose 10 ml is short, by name: the ones the quote flagged after
 * sharing with the cart's own lines, and any of the five whose 10 ml no longer exists at all.
 */
function missingTenMl(
  view: BuilderLineView,
  composition: readonly { fragranceId: number; name: string }[],
): string[] {
  const found = new Set(view.items.map((i) => i.fragranceId));
  return [
    ...view.short.map((f) => f.name),
    ...composition.filter((f) => !found.has(f.fragranceId)).map((f) => f.name),
  ];
}
