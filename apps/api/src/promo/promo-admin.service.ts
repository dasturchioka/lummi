import {
  tashkentToUtc,
  utcToTashkent,
  type AdminPromoCode,
  type PromoCodeInput,
} from '@lummi/contracts';
import {
  desc,
  eq,
  inArray,
  promoCodes,
  promoCodeUses,
  sql,
  type Db,
  type DbOrTx,
  type PromoCodeRow,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { promoState } from './promo-codes';

export type PromoFailure = { ok: false; reason: 'not_found' | 'code_taken' | 'in_use' };
export type PromoOutcome<T> = { ok: true; value: T } | PromoFailure;
const fail = (reason: PromoFailure['reason']): PromoFailure => ({ ok: false, reason });

/** The stored columns an input sets; `expiresOn` becomes the instant 23:59:59 Tashkent that day. */
function toColumns(input: PromoCodeInput) {
  return {
    code: input.code,
    kind: input.kind,
    percent: input.percent,
    amount: input.amount,
    maxDiscount: input.maxDiscount,
    expiresAt: input.expiresOn === null ? null : lastInstantOf(input.expiresOn),
    minOrderTotal: input.minOrderTotal,
    totalLimit: input.totalLimit,
    perCustomerLimit: input.perCustomerLimit,
    newCustomersOnly: input.newCustomersOnly,
    appliesToMarkedDown: input.appliesToMarkedDown,
    active: input.active,
  };
}

/** The last second a code works: 23:59:59 Asia/Tashkent of its last day (spec Changes 2026-11-07). */
function lastInstantOf(day: string): Date {
  const [year, month, d] = day.split('-').map(Number) as [number, number, number];
  const at = tashkentToUtc({ year, month, day: d, hour: 23, minute: 59, second: 59 });
  if (!at) throw new Error(`not a calendar day: ${day}`);
  return at;
}

function dayOf(at: Date | null): string | null {
  if (!at) return null;
  const t = utcToTashkent(at);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

/** The editable fields as the form shows them, for the audit diff. */
function fieldsOf(r: PromoCodeRow): Record<string, unknown> {
  return {
    code: r.code,
    kind: r.kind,
    percent: r.percent,
    amount: r.amount,
    maxDiscount: r.maxDiscount,
    expiresOn: dayOf(r.expiresAt),
    minOrderTotal: r.minOrderTotal,
    totalLimit: r.totalLimit,
    perCustomerLimit: r.perCustomerLimit,
    newCustomersOnly: r.newCustomersOnly,
    appliesToMarkedDown: r.appliesToMarkedDown,
    active: r.active,
  };
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) if (before[k] !== after[k]) out[k] = [before[k], after[k]];
  return out;
}

/** 23505, whether Drizzle wrapped the driver error or not. */
function isUniqueViolation(e: unknown): boolean {
  const err = (e as { code?: string; cause?: { code?: string } }) ?? {};
  return err.code === '23505' || err.cause?.code === '23505';
}

/** Owner-only promo code admin (ADR 0017): every change is audited with the actor. */
@Injectable()
export class PromoAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminPromoCode[]> {
    const rows = await this.db.select().from(promoCodes).orderBy(desc(promoCodes.id));
    return this.withUses(this.db, rows);
  }

  async get(id: number, tx: DbOrTx = this.db): Promise<AdminPromoCode | null> {
    const [row] = await tx.select().from(promoCodes).where(eq(promoCodes.id, id));
    return row ? ((await this.withUses(tx, [row]))[0] ?? null) : null;
  }

  async create(actor: StaffRow, input: PromoCodeInput): Promise<PromoOutcome<AdminPromoCode>> {
    try {
      return await this.db.transaction(async (tx) => {
        const now = this.edges.clock.now();
        const [row] = await tx
          .insert(promoCodes)
          .values({ ...toColumns(input), createdAt: now, updatedAt: now })
          .returning();
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'promo.created',
          targetType: 'promo_code',
          targetId: row!.id,
          payload: fieldsOf(row!),
        });
        return { ok: true, value: (await this.get(row!.id, tx))! } as const;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail('code_taken');
      throw e;
    }
  }

  /** Orders already placed keep their snapshot; the limits keep counting the uses they hold. */
  async update(
    actor: StaffRow,
    id: number,
    input: PromoCodeInput,
  ): Promise<PromoOutcome<AdminPromoCode>> {
    try {
      return await this.db.transaction(async (tx) => {
        // the same row lock `createOrder` takes, so an order never prices with half an edit
        const [old] = await tx.select().from(promoCodes).where(eq(promoCodes.id, id)).for('update');
        if (!old) return fail('not_found');
        const before = fieldsOf(old);
        const changed = diff(before, { ...before, ...fieldsOf({ ...old, ...toColumns(input) }) });
        if (Object.keys(changed).length === 0)
          return { ok: true, value: (await this.get(id, tx))! } as const;
        await tx
          .update(promoCodes)
          .set({ ...toColumns(input), updatedAt: this.edges.clock.now() })
          .where(eq(promoCodes.id, id));
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'promo.updated',
          targetType: 'promo_code',
          targetId: id,
          payload: { code: input.code, changed },
        });
        return { ok: true, value: (await this.get(id, tx))! } as const;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail('code_taken');
      throw e;
    }
  }

  /** Only a code no order ever took: the uses keep the promo report's history (switch it off instead). */
  async remove(actor: StaffRow, id: number): Promise<PromoOutcome<true>> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx.select().from(promoCodes).where(eq(promoCodes.id, id)).for('update');
      if (!old) return fail('not_found');
      const [used] = await tx
        .select({ id: promoCodeUses.id })
        .from(promoCodeUses)
        .where(eq(promoCodeUses.promoCodeId, id))
        .limit(1);
      if (used) return fail('in_use');
      await tx.delete(promoCodes).where(eq(promoCodes.id, id));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'promo.deleted',
        targetType: 'promo_code',
        targetId: id,
        payload: { code: old.code },
      });
      return { ok: true, value: true } as const;
    });
  }

  private async withUses(tx: DbOrTx, rows: PromoCodeRow[]): Promise<AdminPromoCode[]> {
    if (rows.length === 0) return [];
    const counts = await tx
      .select({
        id: promoCodeUses.promoCodeId,
        uses: sql<number>`(count(*) filter (where ${promoCodeUses.voidedAt} is null))::int`,
        ever: sql<number>`count(*)::int`,
      })
      .from(promoCodeUses)
      .where(
        inArray(
          promoCodeUses.promoCodeId,
          rows.map((r) => r.id),
        ),
      )
      .groupBy(promoCodeUses.promoCodeId);
    const byId = new Map(counts.map((c) => [c.id, c]));
    const now = this.edges.clock.now();
    return rows.map((r) => {
      const c = byId.get(r.id);
      const uses = Number(c?.uses ?? 0);
      return {
        id: r.id,
        code: r.code,
        kind: r.kind,
        percent: r.percent,
        amount: r.amount,
        maxDiscount: r.maxDiscount,
        expiresOn: dayOf(r.expiresAt),
        minOrderTotal: r.minOrderTotal,
        totalLimit: r.totalLimit,
        perCustomerLimit: r.perCustomerLimit,
        newCustomersOnly: r.newCustomersOnly,
        appliesToMarkedDown: r.appliesToMarkedDown,
        active: r.active,
        uses,
        everUsed: Number(c?.ever ?? 0) > 0,
        state: promoState(r, uses, now),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }
}
