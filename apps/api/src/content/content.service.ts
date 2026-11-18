import {
  ACTIVE_BANNERS_MAX,
  type AdminBanner,
  type CONTENT_PLACEHOLDERS,
  type AdminInfoPage,
  type BannerInput,
  type BannerMoveDirection,
  type HomeContent,
  type InfoPage,
  type InfoPageInput,
  type InfoPageListItem,
  type PromoBanner,
  type Slogan,
} from '@lummi/contracts';
import {
  contentTexts,
  eq,
  asc,
  promoBanners,
  infoPages,
  sql,
  type Db,
  type DbOrTx,
  type PromoBannerRow,
  type InfoPageRow,
  type StaffRow,
} from '@lummi/db';
import {
  deliveryEta,
  fill,
  formatDuration,
  formatMoney,
  normalizeUzbek,
  type Language,
} from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { storeUploadedPhoto } from '../catalog/photo-pipeline';
import type { Edges } from '../edges';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';

export type ContentFailure = { ok: false; reason: 'not_found' | 'invalid'; fields?: string[] };
export type ContentOutcome<T> = { ok: true; value: T } | ContentFailure;
const fail = (reason: ContentFailure['reason'], fields?: string[]): ContentFailure => ({
  ok: false,
  reason,
  fields,
});

export const SLOGAN_KEY = 'home.slogan';
/**
 * Serialises every change to the slider (on, off, move), so two at once never pass
 * `ACTIVE_BANNERS_MAX` or take the same place. Taken before any row lock, so they never deadlock.
 */
const BANNER_SLIDER_LOCK = 7_210_021;
const emptyToNull = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());

/**
 * Fills the `{placeholders}` of a page body from the settings (`CONTENT_PLACEHOLDERS`). Money
 * follows the body's language; an unknown `{name}` stays visible so a typo shows up.
 */
function fillBody(
  body: string,
  language: Language,
  v: {
    threshold: number;
    tariff: number;
    manager: string;
    reserveSeconds: number;
    etaHours: number;
  },
): string {
  return fill(body, {
    freeDeliveryThreshold: formatMoney(v.threshold, language),
    defaultTariff: formatMoney(v.tariff, language),
    managerUsername: v.manager,
    managerLink: `https://t.me/${v.manager.replace(/^@/, '')}`,
    // how long an order waits for its payment (the reserve, ADR 0012): «12 часов» / «12 soat»
    reserveTime: formatDuration(v.reserveSeconds, language),
    deliveryTerm: deliveryEta(language, v.etaHours),
  } satisfies Record<(typeof CONTENT_PLACEHOLDERS)[number], string>);
}

/** Uzbek texts are normalised on every save (ADR 0018). */
export function normaliseBanner(input: BannerInput) {
  return {
    titleRu: input.titleRu,
    titleUz: normalizeUzbek(input.titleUz),
    subtitleRu: input.subtitleRu,
    subtitleUz: normalizeUzbek(input.subtitleUz),
    priceLineRu: emptyToNull(input.priceLineRu),
    priceLineUz: input.priceLineUz === null ? null : emptyToNull(normalizeUzbek(input.priceLineUz)),
    target: input.target,
  };
}

function toPromo(r: PromoBannerRow): PromoBanner {
  return {
    id: r.id,
    imageHash: r.imageHash,
    titleRu: r.titleRu,
    titleUz: r.titleUz,
    subtitleRu: r.subtitleRu,
    subtitleUz: r.subtitleUz,
    priceLineRu: r.priceLineRu,
    priceLineUz: r.priceLineUz,
    target: r.target,
  };
}
/** A banner as the audit names it: its id and RU title, as `content.banner_created` does. */
const bannerRef = (r: PromoBannerRow) => ({ id: r.id, title: r.titleRu });
const toAdminBanner = (r: PromoBannerRow): AdminBanner => ({
  ...toPromo(r),
  active: r.active,
  updatedAt: r.updatedAt.toISOString(),
});
const toListItem = (r: InfoPageRow): InfoPageListItem => ({
  slug: r.slug as InfoPageListItem['slug'],
  titleRu: r.titleRu,
  titleUz: r.titleUz,
  draft: r.draft,
});
const toPage = (r: InfoPageRow): InfoPage => ({
  ...toListItem(r),
  bodyRu: r.bodyRu,
  bodyUz: r.bodyUz,
});
const toAdminPage = (r: InfoPageRow): AdminInfoPage => ({
  ...toPage(r),
  updatedAt: r.updatedAt.toISOString(),
});

/** The keys whose value differs, for audit payloads (`[before, after]` pairs). */
function diff<T extends Record<string, unknown>>(before: T, after: T) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) if (before[k] !== after[k]) out[k] = [before[k], after[k]];
  return out;
}

@Injectable()
export class ContentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---- customer reads ----

  /** The slider's promo slides (the active banners in order) and the saved slogan, read together for Home. */
  async home(): Promise<HomeContent> {
    const [banners, slogan] = await Promise.all([this.slider(this.db), this.slogan()]);
    return { banners: banners.map(toPromo), slogan };
  }

  /** The active banners in slider order: `position`, then id (rows from before #62 all share 0). */
  private slider(db: DbOrTx) {
    return db
      .select()
      .from(promoBanners)
      .where(eq(promoBanners.active, true))
      .orderBy(asc(promoBanners.position), asc(promoBanners.id));
  }

  async slogan(): Promise<Slogan | null> {
    const [row] = await this.db.select().from(contentTexts).where(eq(contentTexts.key, SLOGAN_KEY));
    return row ? { ru: row.ru, uz: row.uz } : null;
  }

  async pages(): Promise<InfoPageListItem[]> {
    const rows = await this.db.select().from(infoPages).orderBy(asc(infoPages.sort));
    return rows.map(toListItem);
  }

  /** A page as customers read it: placeholders filled from the settings. */
  async page(slug: string): Promise<InfoPage | null> {
    const [row] = await this.db.select().from(infoPages).where(eq(infoPages.slug, slug));
    if (!row) return null;
    const s = await readSettings(this.db, [
      'pricing.freeDeliveryThreshold',
      'delivery.defaultTariff',
      'shop.managerUsername',
      'orders.reserveTtlSeconds',
      'delivery.etaHours',
    ]);
    const v = {
      threshold: s['pricing.freeDeliveryThreshold'],
      tariff: s['delivery.defaultTariff'],
      manager: s['shop.managerUsername'],
      reserveSeconds: s['orders.reserveTtlSeconds'],
      etaHours: s['delivery.etaHours'],
    };
    const page = toPage(row);
    return {
      ...page,
      bodyRu: fillBody(page.bodyRu, 'ru', v),
      bodyUz: fillBody(page.bodyUz, 'uz', v),
    };
  }

  // ---- admin: banners ----

  /** The active banners first, in slider order, then the others newest first. */
  async listBanners(db: DbOrTx = this.db): Promise<AdminBanner[]> {
    const [on, all] = await Promise.all([this.slider(db), db.select().from(promoBanners)]);
    const off = all.filter((r) => !r.active).sort((a, b) => b.id - a.id);
    return [...on, ...off].map(toAdminBanner);
  }

  async createBanner(actor: StaffRow, input: BannerInput): Promise<ContentOutcome<AdminBanner>> {
    const values = normaliseBanner(input);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(promoBanners).values(values).returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.banner_created',
        targetType: 'promo_banner',
        targetId: row!.id,
        payload: { title: values.titleRu, target: values.target },
      });
      return { ok: true, value: toAdminBanner(row!) } as const;
    });
  }

  async updateBanner(
    actor: StaffRow,
    id: number,
    input: BannerInput,
  ): Promise<ContentOutcome<AdminBanner>> {
    const values = normaliseBanner(input);
    return this.db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(promoBanners)
        .where(eq(promoBanners.id, id))
        .for('update');
      if (!old) return fail('not_found');
      const changed = diff(toPromo(old) as unknown as Record<string, unknown>, {
        ...(toPromo(old) as unknown as Record<string, unknown>),
        ...values,
      });
      if (Object.keys(changed).length === 0)
        return { ok: true, value: toAdminBanner(old) } as const;
      const [row] = await tx
        .update(promoBanners)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(promoBanners.id, id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.banner_updated',
        targetType: 'promo_banner',
        targetId: id,
        payload: { changed },
      });
      return { ok: true, value: toAdminBanner(row!) } as const;
    });
  }

  /**
   * Switching on makes the banner the last slide (it needs a photo, and at most
   * `ACTIVE_BANNERS_MAX` are on); switching off takes it out. The other banners stay as they are.
   * The audit names the banner and the slider after the change.
   */
  async setBannerActive(
    actor: StaffRow,
    id: number,
    active: boolean,
  ): Promise<ContentOutcome<AdminBanner>> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${BANNER_SLIDER_LOCK})`);
      const [old] = await tx
        .select()
        .from(promoBanners)
        .where(eq(promoBanners.id, id))
        .for('update');
      if (!old) return fail('not_found');
      if (old.active === active) return { ok: true, value: toAdminBanner(old) } as const;
      if (active && !old.imageHash) return fail('invalid', ['image']);
      const slider = await this.slider(tx);
      if (active && slider.length >= ACTIVE_BANNERS_MAX) return fail('invalid', ['limit']);
      const position = active ? (slider.at(-1)?.position ?? 0) + 1 : old.position;
      const [row] = await tx
        .update(promoBanners)
        .set({ active, position, updatedAt: new Date() })
        .where(eq(promoBanners.id, id))
        .returning();
      const after = active ? [...slider, row!] : slider.filter((r) => r.id !== id);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: active ? 'content.banner_activated' : 'content.banner_deactivated',
        targetType: 'promo_banner',
        targetId: id,
        payload: { title: old.titleRu, slider: after.map(bannerRef) },
      });
      return { ok: true, value: toAdminBanner(row!) } as const;
    });
  }

  /**
   * Moves an active banner one slide toward the first (`up`) or the last (`down`). The slides
   * are renumbered 1..n, so rows that shared a position get their own. The first up or the last
   * down changes nothing and writes nothing. Answers the list as `listBanners` does.
   */
  async moveBanner(
    actor: StaffRow,
    id: number,
    direction: BannerMoveDirection,
  ): Promise<ContentOutcome<AdminBanner[]>> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${BANNER_SLIDER_LOCK})`);
      const [target] = await tx.select().from(promoBanners).where(eq(promoBanners.id, id));
      if (!target) return fail('not_found');
      if (!target.active) return fail('invalid', ['active']);
      const before = await this.slider(tx);
      const from = before.findIndex((r) => r.id === id);
      const to = direction === 'up' ? from - 1 : from + 1;
      if (to < 0 || to >= before.length) {
        return { ok: true, value: await this.listBanners(tx) } as const;
      }
      const after = [...before];
      [after[from], after[to]] = [after[to]!, after[from]!];
      for (const [i, r] of after.entries()) {
        if (r.position === i + 1) continue;
        await tx
          .update(promoBanners)
          .set({ position: i + 1 })
          .where(eq(promoBanners.id, r.id));
      }
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.banner_moved',
        targetType: 'promo_banner',
        targetId: id,
        payload: {
          title: target.titleRu,
          direction,
          before: before.map(bannerRef),
          after: after.map(bannerRef),
        },
      });
      return { ok: true, value: await this.listBanners(tx) } as const;
    });
  }

  async deleteBanner(actor: StaffRow, id: number): Promise<ContentOutcome<true>> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx.delete(promoBanners).where(eq(promoBanners.id, id)).returning();
      if (!old) return fail('not_found');
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.banner_deleted',
        targetType: 'promo_banner',
        targetId: id,
        payload: { title: old.titleRu, wasActive: old.active },
      });
      return { ok: true, value: true } as const;
    });
  }

  async setBannerPhoto(
    actor: StaffRow,
    id: number,
    bytes: Uint8Array,
  ): Promise<ContentOutcome<AdminBanner>> {
    const [exists] = await this.db
      .select({ id: promoBanners.id })
      .from(promoBanners)
      .where(eq(promoBanners.id, id));
    if (!exists) return fail('not_found');
    const stored = await storeUploadedPhoto(this.edges.files, bytes);
    if (!stored) return fail('invalid', ['photo']);
    return this.db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(promoBanners)
        .where(eq(promoBanners.id, id))
        .for('update');
      if (!old) return fail('not_found');
      const [row] = await tx
        .update(promoBanners)
        .set({ imageHash: stored.hash, updatedAt: new Date() })
        .where(eq(promoBanners.id, id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.banner_photo_uploaded',
        targetType: 'promo_banner',
        targetId: id,
        payload: { photo: [old.imageHash, stored.hash] },
      });
      return { ok: true, value: toAdminBanner(row!) } as const;
    });
  }

  // ---- admin: slogan ----

  async setSlogan(actor: StaffRow, input: Slogan): Promise<ContentOutcome<Slogan>> {
    const next = { ru: input.ru, uz: normalizeUzbek(input.uz) };
    return this.db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(contentTexts)
        .where(eq(contentTexts.key, SLOGAN_KEY))
        .for('update');
      if (old && old.ru === next.ru && old.uz === next.uz)
        return { ok: true, value: next } as const;
      await tx
        .insert(contentTexts)
        .values({ key: SLOGAN_KEY, ...next })
        .onConflictDoUpdate({ target: contentTexts.key, set: { ...next, updatedAt: new Date() } });
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.slogan_changed',
        targetType: 'content_text',
        targetId: SLOGAN_KEY,
        payload: { ru: [old?.ru ?? null, next.ru], uz: [old?.uz ?? null, next.uz] },
      });
      return { ok: true, value: next } as const;
    });
  }

  // ---- admin: pages ----

  async listAdminPages(): Promise<AdminInfoPage[]> {
    const rows = await this.db.select().from(infoPages).orderBy(asc(infoPages.sort));
    return rows.map(toAdminPage);
  }

  async updatePage(
    actor: StaffRow,
    slug: string,
    input: InfoPageInput,
  ): Promise<ContentOutcome<AdminInfoPage>> {
    const next = {
      titleRu: input.titleRu,
      titleUz: normalizeUzbek(input.titleUz),
      bodyRu: input.bodyRu,
      bodyUz: normalizeUzbek(input.bodyUz),
      draft: input.draft,
    };
    return this.db.transaction(async (tx) => {
      const [old] = await tx.select().from(infoPages).where(eq(infoPages.slug, slug)).for('update');
      if (!old) return fail('not_found');
      const changed = Object.keys(
        diff(
          {
            titleRu: old.titleRu,
            titleUz: old.titleUz,
            bodyRu: old.bodyRu,
            bodyUz: old.bodyUz,
            draft: old.draft,
          },
          next,
        ),
      );
      if (changed.length === 0) return { ok: true, value: toAdminPage(old) } as const;
      const [row] = await tx
        .update(infoPages)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(infoPages.slug, slug))
        .returning();
      // bodies are long: the audit keeps which fields changed and the draft flag's pair
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.page_updated',
        targetType: 'info_page',
        targetId: slug,
        payload: {
          changed,
          ...(old.draft !== next.draft ? { draft: [old.draft, next.draft] } : {}),
        },
      });
      return { ok: true, value: toAdminPage(row!) } as const;
    });
  }
}
