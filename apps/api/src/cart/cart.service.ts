import type { CartDto, CartSuggestionDto } from '@lummi/contracts';
import {
  and,
  asc,
  cartLines,
  carts,
  desc,
  eq,
  fragrances,
  sql,
  volumes,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { reservedByVolume } from '../catalog/catalog.service';
import { DeliveryService } from '../delivery/delivery.service';
import type { Edges } from '../edges';
import { quote, type DiscountChoice, type QuoteLineInput } from '../pricing/quote';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';

const SUGGESTION_LIMIT = 3;

export type AddOutcome = 'ok' | 'not_found' | 'sold_out';

interface Loaded {
  lineId: number;
  volumeId: number;
  slug: string;
  name: string;
  ml: number;
  photo: string | null;
  qty: number;
  price: number;
  salePrice: number | null;
  saleEndsAt: Date | null;
  available: number;
}

/** The customer's server-side cart (spec Changes 2026-11-10). Money comes only from `quote()`. */
@Injectable()
export class CartService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(DeliveryService) private readonly delivery: DeliveryService,
  ) {}

  /** The cart as it is now: lines capped at available, a fresh quote, suggestions. */
  async get(customerId: number, tx: DbOrTx = this.db): Promise<CartDto> {
    const rows = await tx
      .select({
        lineId: cartLines.id,
        volumeId: cartLines.volumeId,
        slug: fragrances.slug,
        name: fragrances.name,
        hidden: fragrances.hidden,
        ml: volumes.ml,
        photo: volumes.photoHash,
        qty: cartLines.qty,
        price: volumes.price,
        salePrice: volumes.salePrice,
        saleEndsAt: volumes.saleEndsAt,
        onHand: volumes.onHand,
      })
      .from(cartLines)
      .innerJoin(volumes, eq(volumes.id, cartLines.volumeId))
      .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
      .where(eq(cartLines.customerId, customerId))
      .orderBy(asc(cartLines.id));
    const reserved = await reservedByVolume(
      tx as Db,
      rows.map((r) => r.volumeId),
    );
    const lines: Loaded[] = rows.map((r) => ({
      ...r,
      // a hidden fragrance is not for sale: its line stays, flagged like a sold-out one
      available: r.hidden ? 0 : Math.max(0, r.onHand - (reserved.get(r.volumeId) ?? 0)),
    }));

    const [state] = await tx.select().from(carts).where(eq(carts.customerId, customerId));
    const city = await this.delivery.getDeliveryCity(customerId, tx);
    const settings = await readSettings(tx, [
      'pricing.freeDeliveryThreshold',
      'pricing.thresholdBase',
      'pricing.discountsApplyToMarkedDown',
      'pricing.fullSizeVolumesMl',
      'delivery.defaultTariff',
    ]);

    const effective = lines.map((l) => ({
      ...l,
      soldOut: l.available === 0,
      // the stored quantity is the wish; what the quote counts never exceeds what is on hand
      qty: l.available === 0 ? l.qty : Math.min(l.qty, l.available),
    }));
    const quoteLines: QuoteLineInput[] = effective.map((l) => ({
      key: String(l.lineId),
      item: { kind: 'volume', fragranceId: 0, volumeMl: l.ml },
      qty: l.qty,
      price: {
        regular: l.price,
        markdown: l.salePrice === null ? null : { price: l.salePrice, endsAt: l.saleEndsAt },
      },
      soldOut: l.soldOut,
    }));
    const q = quote({
      lines: quoteLines,
      entitlements: [],
      promoCode: null,
      choice: (state?.discountChoice as DiscountChoice | null) ?? null,
      deliveryTariff: city?.region.deliveryTariff ?? settings['delivery.defaultTariff'],
      settings: {
        freeDeliveryThreshold: settings['pricing.freeDeliveryThreshold'],
        thresholdBase: settings['pricing.thresholdBase'],
        discountsApplyToMarkedDown: settings['pricing.discountsApplyToMarkedDown'],
        fullSizeVolumesMl: settings['pricing.fullSizeVolumesMl'],
      },
      now: this.edges.clock.now(),
    });

    const suggestions =
      q.itemsSubtotal > 0 && q.amountToFreeDelivery > 0
        ? await this.suggestions(tx, new Set(lines.map((l) => l.volumeId)))
        : [];
    return {
      lines: effective.map((l) => ({
        id: l.lineId,
        slug: l.slug,
        name: l.name,
        ml: l.ml as 10 | 30 | 50,
        photo: l.photo,
        qty: l.qty,
        available: l.available,
        soldOut: l.soldOut,
      })),
      quote: q,
      count: effective.filter((l) => !l.soldOut).reduce((n, l) => n + l.qty, 0),
      deliveryCity: city,
      suggestions,
      promoCode: state?.promoCode ?? null,
    };
  }

  /**
   * Up to 3 bottles of 10 ml that can be bought and are not in the cart. "Top sellers first":
   * until orders exist there are no sales, so the rule is the pinned (hit) ones, then the newest.
   */
  private async suggestions(tx: DbOrTx, inCart: Set<number>): Promise<CartSuggestionDto[]> {
    const rows = await tx
      .select({
        volumeId: volumes.id,
        slug: fragrances.slug,
        name: fragrances.name,
        photo: volumes.photoHash,
        price: volumes.price,
        salePrice: volumes.salePrice,
        saleEndsAt: volumes.saleEndsAt,
        onHand: volumes.onHand,
      })
      .from(volumes)
      .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
      .where(and(eq(volumes.ml, 10), eq(fragrances.hidden, false), sql`${volumes.onHand} > 0`))
      .orderBy(desc(fragrances.isHit), desc(fragrances.isNew), desc(fragrances.id))
      .limit(60);
    const reserved = await reservedByVolume(
      tx as Db,
      rows.map((r) => r.volumeId),
    );
    const now = this.edges.clock.now();
    return rows
      .filter((r) => !inCart.has(r.volumeId) && r.onHand - (reserved.get(r.volumeId) ?? 0) > 0)
      .slice(0, SUGGESTION_LIMIT)
      .map((r) => {
        const live = r.salePrice !== null && (r.saleEndsAt === null || r.saleEndsAt > now);
        return {
          slug: r.slug,
          name: r.name,
          ml: 10 as const,
          photo: r.photo,
          price: live && r.salePrice !== null && r.salePrice < r.price ? r.salePrice : r.price,
        };
      });
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
      const reserved = await reservedByVolume(tx as unknown as Db, [v.id]);
      const available = Math.max(0, v.onHand - (reserved.get(v.id) ?? 0));
      if (available === 0) return 'sold_out' as const;
      await this.touch(tx, customerId);
      await tx
        .insert(cartLines)
        .values({ customerId, volumeId: v.id, qty: Math.min(qty, available) })
        .onConflictDoUpdate({
          target: [cartLines.customerId, cartLines.volumeId],
          set: { qty: sql`least(${cartLines.qty} + ${qty}, ${available})` },
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
      const reserved = await reservedByVolume(tx as unknown as Db, [row.volumeId]);
      const available = row.hidden
        ? 0
        : Math.max(0, row.onHand - (reserved.get(row.volumeId) ?? 0));
      // a sold-out line keeps what the customer asked for; restocking brings it back
      if (available > 0) {
        await tx
          .update(cartLines)
          .set({ qty: Math.min(qty, available) })
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
