import type {
  AdminBanner,
  AdminInfoPage,
  BannerInput,
  InfoPage,
  InfoPageInput,
  InfoPageListItem,
  PromoBanner,
  Slogan,
} from '@lummi/contracts';
import {
  contentTexts,
  desc,
  eq,
  asc,
  homeBanners,
  infoPages,
  ne,
  type Db,
  type HomeBannerRow,
  type InfoPageRow,
  type StaffRow,
} from '@lummi/db';
import { normalizeUzbek } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { storeUploadedPhoto } from '../catalog/photo-pipeline';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';

export type ContentFailure = { ok: false; reason: 'not_found' | 'invalid'; fields?: string[] };
export type ContentOutcome<T> = { ok: true; value: T } | ContentFailure;
const fail = (reason: ContentFailure['reason'], fields?: string[]): ContentFailure => ({
  ok: false,
  reason,
  fields,
});

export const SLOGAN_KEY = 'home.slogan';
const emptyToNull = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());

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

function toPromo(r: HomeBannerRow): PromoBanner {
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
const toAdminBanner = (r: HomeBannerRow): AdminBanner => ({
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

  async activeBanner(): Promise<PromoBanner | null> {
    const [row] = await this.db.select().from(homeBanners).where(eq(homeBanners.active, true));
    return row ? toPromo(row) : null;
  }

  async slogan(): Promise<Slogan | null> {
    const [row] = await this.db.select().from(contentTexts).where(eq(contentTexts.key, SLOGAN_KEY));
    return row ? { ru: row.ru, uz: row.uz } : null;
  }

  async pages(): Promise<InfoPageListItem[]> {
    const rows = await this.db.select().from(infoPages).orderBy(asc(infoPages.sort));
    return rows.map(toListItem);
  }

  async page(slug: string): Promise<InfoPage | null> {
    const [row] = await this.db.select().from(infoPages).where(eq(infoPages.slug, slug));
    return row ? toPage(row) : null;
  }

  // ---- admin: banners ----

  async listBanners(): Promise<AdminBanner[]> {
    const rows = await this.db
      .select()
      .from(homeBanners)
      .orderBy(desc(homeBanners.active), desc(homeBanners.id));
    return rows.map(toAdminBanner);
  }

  async createBanner(actor: StaffRow, input: BannerInput): Promise<ContentOutcome<AdminBanner>> {
    const values = normaliseBanner(input);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(homeBanners).values(values).returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.banner_created',
        targetType: 'home_banner',
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
      const [old] = await tx.select().from(homeBanners).where(eq(homeBanners.id, id)).for('update');
      if (!old) return fail('not_found');
      const changed = diff(toPromo(old) as unknown as Record<string, unknown>, {
        ...(toPromo(old) as unknown as Record<string, unknown>),
        ...values,
      });
      if (Object.keys(changed).length === 0)
        return { ok: true, value: toAdminBanner(old) } as const;
      const [row] = await tx
        .update(homeBanners)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(homeBanners.id, id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.banner_updated',
        targetType: 'home_banner',
        targetId: id,
        payload: { changed },
      });
      return { ok: true, value: toAdminBanner(row!) } as const;
    });
  }

  /** Activating switches the previous banner off in the same transaction; the partial unique index backs it. */
  async setBannerActive(
    actor: StaffRow,
    id: number,
    active: boolean,
  ): Promise<ContentOutcome<AdminBanner>> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx.select().from(homeBanners).where(eq(homeBanners.id, id)).for('update');
      if (!old) return fail('not_found');
      if (old.active === active) return { ok: true, value: toAdminBanner(old) } as const;
      if (active && !old.imageHash) return fail('invalid', ['image']);
      let replaced: number[] = [];
      if (active) {
        const off = await tx
          .update(homeBanners)
          .set({ active: false, updatedAt: new Date() })
          .where(ne(homeBanners.id, id))
          .returning({ id: homeBanners.id, active: homeBanners.active });
        replaced = off.map((r) => r.id);
      }
      const [row] = await tx
        .update(homeBanners)
        .set({ active, updatedAt: new Date() })
        .where(eq(homeBanners.id, id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: active ? 'content.banner_activated' : 'content.banner_deactivated',
        targetType: 'home_banner',
        targetId: id,
        payload: { switchedOff: replaced },
      });
      return { ok: true, value: toAdminBanner(row!) } as const;
    });
  }

  async deleteBanner(actor: StaffRow, id: number): Promise<ContentOutcome<true>> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx.delete(homeBanners).where(eq(homeBanners.id, id)).returning();
      if (!old) return fail('not_found');
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.banner_deleted',
        targetType: 'home_banner',
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
      .select({ id: homeBanners.id })
      .from(homeBanners)
      .where(eq(homeBanners.id, id));
    if (!exists) return fail('not_found');
    const stored = await storeUploadedPhoto(this.edges.files, bytes);
    if (!stored) return fail('invalid', ['photo']);
    return this.db.transaction(async (tx) => {
      const [old] = await tx.select().from(homeBanners).where(eq(homeBanners.id, id)).for('update');
      if (!old) return fail('not_found');
      const [row] = await tx
        .update(homeBanners)
        .set({ imageHash: stored.hash, updatedAt: new Date() })
        .where(eq(homeBanners.id, id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'content.banner_photo_uploaded',
        targetType: 'home_banner',
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
