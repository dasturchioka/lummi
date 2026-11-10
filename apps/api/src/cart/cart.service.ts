import {
  CART_MAX_QTY,
  type CartDto,
  type CartLineDto,
  type CartSuggestionDto,
} from '@lummi/contracts';
import {
  and,
  cartLines,
  carts,
  eq,
  fragrances,
  gte,
  notInArray,
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
import { loadCartQuote } from './load-cart';

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
      lines: lines.map((l): CartLineDto => {
        const base = {
          id: l.lineId,
          photo: l.photo,
          qty: l.qty,
          available: l.available,
          soldOut: l.soldOut,
          limited: l.limited,
        };
        return l.kind === 'volume'
          ? {
              ...base,
              kind: 'volume',
              slug: l.slug,
              name: l.name,
              brand: l.brand,
              ml: l.ml as 10 | 30 | 50,
            }
          : l.kind === 'builder_set'
            ? {
                ...base,
                kind: l.kind,
                fragrances: l.items.map(({ slug, name, brand }) => ({ slug, name, brand })),
                short: l.short,
              }
            : {
                ...base,
                kind: l.kind,
                fragrances: l.items.map(({ slug, name, brand }) => ({ slug, name, brand })),
              };
      }),
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
