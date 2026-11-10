import {
  CART_MAX_QTY,
  type CartDto,
  type CartLineDto,
  type CartSuggestionDto,
  type RepeatResultDto,
} from '@lummi/contracts';
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
  sql,
  volumes,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { available, CatalogService, reservedByVolume } from '../catalog/catalog.service';
import type { Edges } from '../edges';
import { activeMarkdown, type DiscountChoice } from '../pricing/quote';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { builderAvailable, judgeBuilderPick, loadDiscovery, tenMlOf } from '../sets/sets';
import { loadCartQuote, loadQuote, readCartLines, toLineDto, type StoredLine } from './load-cart';

export type AddOutcome = 'ok' | 'not_found' | 'sold_out';
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

  /** The cart as it is now: lines capped at available, a fresh quote, suggestions. */
  async get(customerId: number, tx: DbOrTx = this.db): Promise<CartDto> {
    const now = this.edges.clock.now();
    const { lines, quote: q, state, city } = await loadCartQuote(tx, now, customerId);
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
      promoCode: state?.promoCode ?? null,
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
          onHand: volumes.onHand,
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
    const reserved = await reservedByVolume(
      tx,
      rows.map((r) => r.volumeId),
    );
    const out: CartSuggestionDto[] = [];
    for (const r of rows) {
      if (available(r.onHand, reserved.get(r.volumeId) ?? 0) === 0) continue;
      const price =
        activeMarkdown(
          {
            regular: r.price,
            markdown: r.salePrice === null ? null : { price: r.salePrice, endsAt: r.saleEndsAt },
          },
          now,
        ) ?? r.price;
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
        .select({ id: volumes.id, onHand: volumes.onHand })
        .from(volumes)
        .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
        .where(and(eq(fragrances.slug, slug), eq(fragrances.hidden, false), eq(volumes.ml, ml)));
      if (!v) return 'not_found' as const;
      const reserved = await reservedByVolume(tx, [v.id]);
      const left = available(v.onHand, reserved.get(v.id) ?? 0);
      if (left === 0) return 'sold_out' as const;
      await this.touch(tx, customerId);
      await tx
        .insert(cartLines)
        .values({ customerId, volumeId: v.id, qty: Math.min(qty, left, CART_MAX_QTY) })
        .onConflictDoUpdate({
          target: [cartLines.customerId, cartLines.volumeId],
          set: { qty: sql`least(${cartLines.qty} + ${qty}, ${left}, ${CART_MAX_QTY})` },
        });
      return 'ok' as const;
    });
  }

  /** Adds the Discovery set; the total on the line never passes the set's own stock. */
  async addDiscovery(customerId: number, qty: number): Promise<AddSetOutcome> {
    return this.db.transaction(async (tx) => {
      const { available: left } = await loadDiscovery(tx);
      if (left === 0) return { result: 'sold_out' } as const;
      await this.touch(tx, customerId);
      await tx
        .insert(cartLines)
        .values({ customerId, kind: 'discovery_set', qty: Math.min(qty, left, CART_MAX_QTY) })
        .onConflictDoUpdate({
          target: [cartLines.customerId],
          targetWhere: sql`kind = 'discovery_set'`,
          set: { qty: sql`least(${cartLines.qty} + ${qty}, ${left}, ${CART_MAX_QTY})` },
        });
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
      await tx
        .insert(cartLines)
        .values({
          customerId,
          kind: 'builder_set',
          fragranceIds,
          qty: Math.min(qty, left, CART_MAX_QTY),
        })
        .onConflictDoUpdate({
          target: [cartLines.customerId, cartLines.fragranceIds],
          targetWhere: sql`kind = 'builder_set'`,
          set: { qty: sql`least(${cartLines.qty} + ${qty}, ${left}, ${CART_MAX_QTY})` },
        });
      return { result: 'ok' } as const;
    });
  }

  /**
   * «Повторить заказ» (spec Changes 2026-11-07 cart, 2026-11-11): the order's lines go into the
   * cart at today's prices (the cart re-quotes them). Each old line is weighed after the cart's own
   * lines, through the same quote that judges the cart, so it takes only what they leave: capped at
   * available and at the per-line ceiling, skipped when nothing is left (a builder set needs all
   * five 10 ml). A line already in the cart (the same volume, the Discovery set, the same five)
   * grows by what was added. Null when the order is not this customer's.
   */
  async repeat(customerId: number, number: number): Promise<RepeatResultDto | null> {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.customerId, customerId), eq(orders.number, number)));
      if (!order) return null;
      const old = await tx
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, order.id))
        .orderBy(asc(orderLines.position));
      // the cart row first: a concurrent add or repeat of this customer waits for this one
      await this.touch(tx, customerId);
      await tx.select().from(carts).where(eq(carts.customerId, customerId)).for('update');
      const cart = await readCartLines(tx, customerId);

      // The old lines after every cart line (ids above the cart's), as the cart would hold them.
      const after = Math.max(0, ...cart.map((l) => l.lineId)) + 1;
      const wanted = old.map((l, i): StoredLine => {
        const line = { lineId: after + i, qty: l.qty, volumeId: null, fragranceIds: null };
        if (l.kind === 'volume') return { ...line, kind: 'volume', volumeId: l.volumeId };
        if (l.kind === 'discovery_set') return { ...line, kind: 'discovery_set' };
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
        const same = cart.find((c) => sameLine(c, w));
        // never past the per-line ceiling on the line it joins
        const added =
          !v || v.soldOut ? 0 : Math.max(0, Math.min(v.qty, CART_MAX_QTY - (same?.qty ?? 0)));
        if (added > 0) await this.addLine(tx, customerId, w, added);
        result.push({
          kind: l.kind,
          name: { ru: l.nameRu, uz: l.nameUz },
          brand: l.brand,
          ml: l.ml,
          ordered: l.qty,
          added,
        });
      }
      return { lines: result, added: result.filter((r) => r.added > 0).length, of: result.length };
    });
  }

  /** Adds `qty` to the cart line holding this volume, the Discovery set or these five. */
  private async addLine(tx: DbOrTx, customerId: number, w: StoredLine, qty: number) {
    const grow = { qty: sql`${cartLines.qty} + ${qty}` };
    if (w.kind === 'volume')
      await tx
        .insert(cartLines)
        .values({ customerId, volumeId: w.volumeId, qty })
        .onConflictDoUpdate({ target: [cartLines.customerId, cartLines.volumeId], set: grow });
    else if (w.kind === 'discovery_set')
      await tx
        .insert(cartLines)
        .values({ customerId, kind: 'discovery_set', qty })
        .onConflictDoUpdate({
          target: [cartLines.customerId],
          targetWhere: sql`kind = 'discovery_set'`,
          set: grow,
        });
    else
      await tx
        .insert(cartLines)
        .values({ customerId, kind: 'builder_set', fragranceIds: w.fragranceIds, qty })
        .onConflictDoUpdate({
          target: [cartLines.customerId, cartLines.fragranceIds],
          targetWhere: sql`kind = 'builder_set'`,
          set: grow,
        });
  }

  /** Sets a quantity, capped at available; false when the line is not this customer's. */
  async setQuantity(customerId: number, lineId: number, qty: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
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
      await this.touch(tx, customerId);
      return true;
    });
  }

  async remove(customerId: number, lineId: number): Promise<void> {
    await this.db
      .delete(cartLines)
      .where(and(eq(cartLines.id, lineId), eq(cartLines.customerId, customerId)));
  }

  /** The customer's switch to another discount (ADR 0002); the discount tickets call this. */
  async setDiscountChoice(customerId: number, choice: DiscountChoice | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.touch(tx, customerId);
      await tx
        .update(carts)
        .set({ discountChoice: choice })
        .where(eq(carts.customerId, customerId));
    });
  }

  /** An entered or link-prefilled code. A typed code is always applied, so it clears any stored choice (ADR 0002). */
  async setPromoCode(customerId: number, code: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.touch(tx, customerId);
      await tx
        .update(carts)
        .set({ promoCode: code ? code.trim().toUpperCase() : null, discountChoice: null })
        .where(eq(carts.customerId, customerId));
    });
  }

  /** Makes sure the customer's cart row exists. */
  private async touch(tx: DbOrTx, customerId: number): Promise<void> {
    await tx
      .insert(carts)
      .values({ customerId })
      .onConflictDoUpdate({ target: carts.customerId, set: { updatedAt: this.edges.clock.now() } });
  }
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

/** Two stored lines hold the same thing: the same volume, the Discovery set, or the same five. */
function sameLine(a: StoredLine, b: StoredLine): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'volume') return a.volumeId === b.volumeId;
  if (a.kind === 'discovery_set') return true;
  return (a.fragranceIds ?? []).join(',') === (b.fragranceIds ?? []).join(',');
}
