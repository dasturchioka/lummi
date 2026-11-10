import { CART_MAX_QTY, type CartDto, type CartSuggestionDto } from '@lummi/contracts';
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
import { loadCartQuote } from './load-cart';

export type AddOutcome = 'ok' | 'not_found' | 'sold_out';
export type ApplyCodeOutcome =
  | { kind: 'ok' }
  | { kind: 'too_many_attempts'; retryAfterSeconds: number };

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
      lines: lines.map((l) => ({
        id: l.lineId,
        slug: l.slug,
        name: l.name,
        brand: l.brand,
        ml: l.ml as 10 | 30 | 50,
        photo: l.photo,
        qty: l.qty,
        available: l.available,
        soldOut: l.soldOut,
        limited: l.limited,
      })),
      quote: q,
      count: lines.filter((l) => !l.soldOut).reduce((n, l) => n + l.qty, 0),
      deliveryCity: city,
      freeDeliveryProgress: progress(q),
      suggestions: open
        ? await this.suggestions(
            tx,
            lines.map((l) => l.volumeId),
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

  /** Sets a quantity, capped at available; false when the line is not this customer's. */
  async setQuantity(customerId: number, lineId: number, qty: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ volumeId: cartLines.volumeId, onHand: volumes.onHand, hidden: fragrances.hidden })
        .from(cartLines)
        .innerJoin(volumes, eq(volumes.id, cartLines.volumeId))
        .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
        .where(and(eq(cartLines.id, lineId), eq(cartLines.customerId, customerId)));
      if (!row) return false;
      const reserved = await reservedByVolume(tx, [row.volumeId]);
      const left = row.hidden ? 0 : available(row.onHand, reserved.get(row.volumeId) ?? 0);
      // a sold-out line keeps what the customer asked for; restocking brings it back
      if (left > 0) {
        await tx
          .update(cartLines)
          .set({ qty: Math.min(qty, left, CART_MAX_QTY) })
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
        .set({ promoCode: code ? normalizeCode(code) : null, discountChoice: null })
        .where(eq(carts.customerId, customerId));
    });
  }

  /**
   * A code the customer typed (ticket #29). Codes are guessable, so each customer may type
   * `promo.attemptLimit` of them per `promo.attemptWindowSeconds` (a fixed window from the first);
   * past that the stored code stays as it was. Whatever the code, it is stored and the quote says
   * whether it applies.
   */
  async applyPromoCode(customerId: number, code: string): Promise<ApplyCodeOutcome> {
    return this.db.transaction(async (tx) => {
      await this.touch(tx, customerId);
      const [row] = await tx
        .select({ attempts: carts.promoAttempts, since: carts.promoAttemptsSince })
        .from(carts)
        .where(eq(carts.customerId, customerId))
        .for('update');
      const s = await readSettings(tx, ['promo.attemptLimit', 'promo.attemptWindowSeconds']);
      const now = this.edges.clock.now();
      const windowMs = s['promo.attemptWindowSeconds'] * 1000;
      const since = row?.since ?? null;
      const fresh = since === null || now.getTime() - since.getTime() >= windowMs;
      const attempts = fresh ? 0 : (row?.attempts ?? 0);
      if (!fresh && attempts >= s['promo.attemptLimit']) {
        const left = since.getTime() + windowMs - now.getTime();
        return { kind: 'too_many_attempts', retryAfterSeconds: Math.max(1, Math.ceil(left / 1000)) };
      }
      await tx
        .update(carts)
        .set({
          promoCode: normalizeCode(code),
          discountChoice: null,
          promoAttempts: attempts + 1,
          promoAttemptsSince: fresh ? now : since,
        })
        .where(eq(carts.customerId, customerId));
      return { kind: 'ok' };
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

/** Codes are stored trimmed and upper-case, so they match case-insensitively (spec Changes 2026-11-07). */
const normalizeCode = (code: string) => code.trim().toUpperCase();

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
