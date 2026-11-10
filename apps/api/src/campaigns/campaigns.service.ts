import { randomBytes } from 'node:crypto';
import {
  campaignStartParam,
  normalizePromoCode,
  type AdminCampaignLink,
  type CampaignLinkInput,
  type OpenCampaignResult,
  type QR_FORMATS,
} from '@lummi/contracts';
import {
  and,
  campaignLinks,
  campaignOpens,
  customers,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  orders,
  promoCodes,
  sql,
  type CampaignLinkRow,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { AuditService, type Actor } from '../audit/audit.service';
import { CartService } from '../cart/cart.service';
import type { Edges } from '../edges';
import { DEV_BOT_LINK, type Env } from '../env';
import { DB, EDGES, ENV } from '../tokens';

export type CampaignFailure = {
  ok: false;
  reason: 'not_found' | 'code_taken' | 'unknown_promo_code' | 'code_locked' | 'in_use';
};
export type CampaignOutcome<T> = { ok: true; value: T } | CampaignFailure;
const fail = (reason: CampaignFailure['reason']): CampaignFailure => ({ ok: false, reason });

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** A short random lowercase code; no look-alike handling needed, the owner may edit it. */
function randomCode(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** 23505, whether Drizzle wrapped the driver error or not. */
function isUniqueViolation(e: unknown): boolean {
  const err = (e as { code?: string; cause?: { code?: string } }) ?? {};
  return err.code === '23505' || err.cause?.code === '23505';
}

/**
 * Campaign links (ticket #35, ADR 0022): the owner's CRUD and QR, the Mini App's open (log, route,
 * prefill) and the one-per-promo-code rule. Attribution on orders is `attributedLinkId`.
 */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(ENV) private readonly env: Env,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CartService) private readonly cart: CartService,
  ) {}

  /** `https://t.me/<bot>?startapp=l_<code>`: the link and what the QR encodes. */
  urlOf(code: string): string {
    const base = (this.env.BOT_LINK ?? DEV_BOT_LINK).replace(/\/$/, '');
    return `${base}?startapp=${campaignStartParam(code)}`;
  }

  // ---- admin ----

  async list(): Promise<AdminCampaignLink[]> {
    return this.withStats(
      this.db,
      await this.db.select().from(campaignLinks).orderBy(desc(campaignLinks.id)),
    );
  }

  async get(id: number, tx: DbOrTx = this.db): Promise<AdminCampaignLink | null> {
    const [row] = await tx.select().from(campaignLinks).where(eq(campaignLinks.id, id));
    return row ? ((await this.withStats(tx, [row]))[0] ?? null) : null;
  }

  async create(
    actor: StaffRow,
    input: CampaignLinkInput,
  ): Promise<CampaignOutcome<AdminCampaignLink>> {
    try {
      return await this.db.transaction(async (tx) => {
        const promo = await this.resolvePromo(tx, input.promoCode);
        if (promo === 'unknown') return fail('unknown_promo_code');
        const now = this.edges.clock.now();
        const [row] = await tx
          .insert(campaignLinks)
          .values({
            code: input.code ?? (await this.freeCode(tx, randomCode(8))),
            target: input.target,
            promoCodeId: promo,
            source: input.source,
            sourceLabel: input.sourceLabel,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'campaign_link.created',
          targetType: 'campaign_link',
          targetId: row!.id,
          payload: fieldsOf(row!, input.promoCode),
        });
        return { ok: true, value: (await this.get(row!.id, tx))! } as const;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail('code_taken');
      throw e;
    }
  }

  /** The code of a link someone opened is fixed: a printed QR or a posted link must keep working. */
  async update(
    actor: StaffRow,
    id: number,
    input: CampaignLinkInput,
  ): Promise<CampaignOutcome<AdminCampaignLink>> {
    try {
      return await this.db.transaction(async (tx) => {
        const [old] = await tx
          .select()
          .from(campaignLinks)
          .where(eq(campaignLinks.id, id))
          .for('update');
        if (!old) return fail('not_found');
        const promo = await this.resolvePromo(tx, input.promoCode);
        if (promo === 'unknown') return fail('unknown_promo_code');
        const code = input.code ?? old.code;
        if (code !== old.code && (await this.everOpened(tx, id))) return fail('code_locked');
        const before = fieldsOf(old, await this.promoText(tx, old.promoCodeId));
        const next = {
          code,
          target: input.target,
          promoCode: input.promoCode,
          source: input.source,
          sourceLabel: input.sourceLabel,
        };
        const changed: Record<string, [unknown, unknown]> = {};
        for (const k of Object.keys(next) as (keyof typeof next)[])
          if (before[k] !== next[k]) changed[k] = [before[k], next[k]];
        if (Object.keys(changed).length > 0) {
          await tx
            .update(campaignLinks)
            .set({
              code,
              target: input.target,
              promoCodeId: promo,
              source: input.source,
              sourceLabel: input.sourceLabel,
              updatedAt: this.edges.clock.now(),
            })
            .where(eq(campaignLinks.id, id));
          await this.audit.record(tx, {
            actor: { type: 'staff', id: actor.id },
            action: 'campaign_link.updated',
            targetType: 'campaign_link',
            targetId: id,
            payload: { code, changed },
          });
        }
        return { ok: true, value: (await this.get(id, tx))! } as const;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail('code_taken');
      throw e;
    }
  }

  /** Only a link nobody opened and no order took: opens and orders keep the reports' history. */
  async remove(actor: StaffRow, id: number): Promise<CampaignOutcome<true>> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(campaignLinks)
        .where(eq(campaignLinks.id, id))
        .for('update');
      if (!old) return fail('not_found');
      if (await this.isReferenced(tx, id)) return fail('in_use');
      await tx.delete(campaignLinks).where(eq(campaignLinks.id, id));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'campaign_link.deleted',
        targetType: 'campaign_link',
        targetId: id,
        payload: { code: old.code },
      });
      return { ok: true, value: true } as const;
    });
  }

  /** The QR of the link's URL as a PNG (a store stand prints it) or an SVG. */
  async qr(
    id: number,
    format: (typeof QR_FORMATS)[number],
  ): Promise<{ code: string; body: Buffer | string } | null> {
    const [row] = await this.db.select().from(campaignLinks).where(eq(campaignLinks.id, id));
    if (!row) return null;
    const url = this.urlOf(row.code);
    const opts = {
      errorCorrectionLevel: 'M',
      margin: 4,
      color: { dark: '#2A2A2A', light: '#FFFFFF' },
    } as const;
    return format === 'svg'
      ? { code: row.code, body: await QRCode.toString(url, { ...opts, type: 'svg' }) }
      : { code: row.code, body: await QRCode.toBuffer(url, { ...opts, type: 'png', width: 1024 }) };
  }

  // ---- promo codes ----

  /**
   * Gives a promo code its link (ticket #35: every code has one): target the catalog, source
   * `other` labelled with the code, the code's own text as the link code (a suffix when taken).
   * The owner edits it like any other link.
   */
  async ensurePromoLink(
    tx: DbOrTx,
    promo: { id: number; code: string },
    actor: Actor,
  ): Promise<boolean> {
    const [has] = await tx
      .select({ id: campaignLinks.id })
      .from(campaignLinks)
      .where(eq(campaignLinks.promoCodeId, promo.id))
      .limit(1);
    if (has) return false;
    const natural = promo.code.toLowerCase();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = attempt === 0 ? natural : `${natural.slice(0, 35)}-${randomCode(4)}`;
      const [row] = await tx
        .insert(campaignLinks)
        .values({
          code,
          target: 'catalog',
          promoCodeId: promo.id,
          source: 'other',
          sourceLabel: promo.code,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      await this.audit.record(tx, {
        actor,
        action: 'campaign_link.created',
        targetType: 'campaign_link',
        targetId: row.id,
        payload: { code: row.code, promoCode: promo.code, automatic: true },
      });
      return true;
    }
    throw new Error(`no free link code for promo code ${promo.code}`);
  }

  /** Codes that predate links (or lost theirs) get one; running it again changes nothing. Returns how many. */
  async backfillPromoLinks(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const linked = tx
        .select({ id: campaignLinks.promoCodeId })
        .from(campaignLinks)
        .where(sql`${campaignLinks.promoCodeId} is not null`);
      const missing = await tx
        .select({ id: promoCodes.id, code: promoCodes.code })
        .from(promoCodes)
        .where(notInArray(promoCodes.id, linked))
        .orderBy(promoCodes.id);
      let made = 0;
      for (const p of missing) if (await this.ensurePromoLink(tx, p, { type: 'system' })) made++;
      return made;
    });
  }

  /** A promo code being deleted: its unopened links go with it, an opened one keeps its history without the code. */
  async releasePromoCode(tx: DbOrTx, promoCodeId: number): Promise<void> {
    const rows = await tx
      .select({ id: campaignLinks.id })
      .from(campaignLinks)
      .where(eq(campaignLinks.promoCodeId, promoCodeId));
    for (const r of rows) {
      if (await this.isReferenced(tx, r.id)) {
        await tx.update(campaignLinks).set({ promoCodeId: null }).where(eq(campaignLinks.id, r.id));
      } else {
        await tx.delete(campaignLinks).where(eq(campaignLinks.id, r.id));
      }
    }
  }

  // ---- the Mini App ----

  /**
   * The customer opened `l_<code>`: log it, keep the first link ever opened as their acquisition
   * source, put the link's promo code in the cart and say where to go. The prefill goes through
   * the cart's own apply path, so the quote judges it like a typed code (its refusal reason shows
   * in the cart); it is not a typed attempt, because the shop supplied it and nobody is guessing.
   */
  async open(customerId: number, code: string): Promise<OpenCampaignResult | null> {
    const now = this.edges.clock.now();
    const found = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ link: campaignLinks, promo: promoCodes.code })
        .from(campaignLinks)
        .leftJoin(promoCodes, eq(promoCodes.id, campaignLinks.promoCodeId))
        // exact case: Telegram keeps it, and lookups are not a way to probe for codes
        .where(eq(campaignLinks.code, code));
      if (!row) return null;
      await tx.insert(campaignOpens).values({ linkId: row.link.id, customerId, openedAt: now });
      // first link wins: only a customer with no acquisition source takes this one
      await tx
        .update(customers)
        .set({ acquisitionLinkId: row.link.id })
        .where(and(eq(customers.id, customerId), isNull(customers.acquisitionLinkId)));
      return row;
    });
    if (!found) return null;
    if (found.promo)
      await this.cart.applyPromoCode(customerId, found.promo, { countAttempt: false });
    return { target: found.link.target, promoCodePrefilled: found.promo !== null };
  }

  // ---- internals ----

  private async resolvePromo(tx: DbOrTx, text: string | null): Promise<number | null | 'unknown'> {
    if (text === null) return null;
    const [row] = await tx
      .select({ id: promoCodes.id })
      .from(promoCodes)
      .where(eq(promoCodes.code, normalizePromoCode(text)));
    return row?.id ?? 'unknown';
  }

  private async promoText(tx: DbOrTx, id: number | null): Promise<string | null> {
    if (id === null) return null;
    const [row] = await tx
      .select({ code: promoCodes.code })
      .from(promoCodes)
      .where(eq(promoCodes.id, id));
    return row?.code ?? null;
  }

  private async freeCode(tx: DbOrTx, candidate: string): Promise<string> {
    const [taken] = await tx
      .select({ id: campaignLinks.id })
      .from(campaignLinks)
      .where(sql`lower(${campaignLinks.code}) = ${candidate.toLowerCase()}`);
    return taken ? this.freeCode(tx, randomCode(8)) : candidate;
  }

  private async everOpened(tx: DbOrTx, id: number): Promise<boolean> {
    const [o] = await tx
      .select({ id: campaignOpens.id })
      .from(campaignOpens)
      .where(eq(campaignOpens.linkId, id))
      .limit(1);
    return !!o;
  }

  /** An open, an order or a customer's acquisition source points at it. */
  private async isReferenced(tx: DbOrTx, id: number): Promise<boolean> {
    if (await this.everOpened(tx, id)) return true;
    const [o] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.campaignLinkId, id))
      .limit(1);
    return !!o;
  }

  private async withStats(tx: DbOrTx, rows: CampaignLinkRow[]): Promise<AdminCampaignLink[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [opens, ordersBy, promos] = await Promise.all([
      tx
        .select({
          id: campaignOpens.linkId,
          unique: sql<number>`count(distinct ${campaignOpens.customerId})::int`,
          all: sql<number>`count(*)::int`,
        })
        .from(campaignOpens)
        .where(inArray(campaignOpens.linkId, ids))
        .groupBy(campaignOpens.linkId),
      tx
        .select({ id: orders.campaignLinkId, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(inArray(orders.campaignLinkId, ids))
        .groupBy(orders.campaignLinkId),
      tx
        .select({ id: promoCodes.id, code: promoCodes.code })
        .from(promoCodes)
        .where(
          inArray(
            promoCodes.id,
            rows.flatMap((r) => r.promoCodeId ?? []),
          ),
        ),
    ]);
    const opensById = new Map(opens.map((o) => [o.id, o]));
    const ordersById = new Map(ordersBy.map((o) => [o.id, o.n]));
    const promoById = new Map(promos.map((p) => [p.id, p.code]));
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      target: r.target,
      promoCode: r.promoCodeId === null ? null : (promoById.get(r.promoCodeId) ?? null),
      source: r.source,
      sourceLabel: r.sourceLabel,
      url: this.urlOf(r.code),
      opens: Number(opensById.get(r.id)?.unique ?? 0),
      orders: Number(ordersById.get(r.id) ?? 0),
      everOpened: (opensById.get(r.id)?.all ?? 0) > 0,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

/** The editable fields as the form shows them: what the audit diffs. */
function fieldsOf(r: CampaignLinkRow, promoCode: string | null) {
  return {
    code: r.code,
    target: r.target,
    promoCode,
    source: r.source,
    sourceLabel: r.sourceLabel,
  };
}
