import { createHash } from 'node:crypto';
import {
  asc,
  families,
  fragranceNotes,
  fragranceSimilar,
  fragrances,
  notes,
  volumes,
  type DbOrTx,
} from '@lummi/db';
import { normalizeUzbek } from '@lummi/i18n';
import { saleEndDay } from '../admin/catalog-admin.service';
import type {
  CatalogData,
  DictionaryDraft,
  FragranceDraft,
  VolumeDraft,
} from './workbook';

export interface SnapVolume extends VolumeDraft {
  id: number;
  isPlaceholder: boolean;
}
export interface SnapFragrance {
  id: number;
  slug: string;
  draft: FragranceDraft;
  volumes: Map<number, SnapVolume>;
}
export interface Snapshot {
  families: (DictionaryDraft & { id: number })[];
  notes: (DictionaryDraft & { id: number })[];
  byCode: Map<string, SnapFragrance>;
}

/** Uzbek texts and aliases are stored normalised (ADR 0018); both sides of every comparison are. */
export function normDraft(d: FragranceDraft): FragranceDraft {
  return {
    ...d,
    code: d.code.trim(),
    name: d.name.trim(),
    originalBrand: d.originalBrand.trim(),
    longevityRu: d.longevityRu.trim(),
    longevityUz: normalizeUzbek(d.longevityUz.trim()),
    descriptionRu: d.descriptionRu.trim(),
    descriptionUz: normalizeUzbek(d.descriptionUz.trim()),
    whenToWearRu: d.whenToWearRu.trim(),
    whenToWearUz: normalizeUzbek(d.whenToWearUz.trim()),
    keyNotesRu: d.keyNotesRu.map((x) => x.trim()),
    keyNotesUz: d.keyNotesUz.map((x) => normalizeUzbek(x.trim())),
    internalRemark: d.internalRemark.trim(),
    aliases: [...new Set(d.aliases.map((x) => normalizeUzbek(x.trim())).filter(Boolean))],
    uzumUrl: d.uzumUrl.trim(),
    oilSupplier: d.oilSupplier.trim(),
    oilInvoice: d.oilInvoice.trim(),
  };
}
export const sameDraft = (a: FragranceDraft, b: FragranceDraft) =>
  JSON.stringify(normDraft(a)) === JSON.stringify(normDraft(b));

export const sameVolume = (a: VolumeDraft, b: VolumeDraft) =>
  a.price === b.price &&
  a.salePrice === b.salePrice &&
  a.saleEndsOn === b.saleEndsOn &&
  a.onHand === b.onHand;

/** The whole catalog as the template carries it (a few hundred rows). */
export async function readSnapshot(db: DbOrTx): Promise<Snapshot> {
  const [fam, nts, frs, links, sims, vols] = await Promise.all([
    db.select().from(families).orderBy(asc(families.id)),
    db.select().from(notes).orderBy(asc(notes.id)),
    db.select().from(fragrances).orderBy(asc(fragrances.id)),
    db
      .select()
      .from(fragranceNotes)
      .orderBy(asc(fragranceNotes.fragranceId), asc(fragranceNotes.position)),
    db
      .select()
      .from(fragranceSimilar)
      .orderBy(asc(fragranceSimilar.fragranceId), asc(fragranceSimilar.position)),
    db.select().from(volumes).orderBy(asc(volumes.fragranceId), asc(volumes.ml)),
  ]);
  const familyName = new Map(fam.map((f) => [f.id, f.nameRu]));
  const noteName = new Map(nts.map((n) => [n.id, n.nameRu]));
  const codeById = new Map(frs.map((f) => [f.id, f.code]));
  const byCode = new Map<string, SnapFragrance>();
  for (const f of frs) {
    const level = (l: 'top' | 'heart' | 'base') =>
      links
        .filter((n) => n.fragranceId === f.id && n.level === l)
        .map((n) => noteName.get(n.noteId)!);
    byCode.set(f.code, {
      id: f.id,
      slug: f.slug,
      volumes: new Map(
        vols
          .filter((v) => v.fragranceId === f.id)
          .map((v) => [
            v.ml,
            {
              id: v.id,
              ml: v.ml as 10 | 30 | 50,
              price: v.price,
              salePrice: v.salePrice,
              saleEndsOn: saleEndDay(v.saleEndsAt),
              onHand: v.onHand,
              isPlaceholder: v.isPlaceholder,
            },
          ]),
      ),
      draft: normDraft({
        code: f.code,
        name: f.name,
        originalBrand: f.originalBrand,
        type: f.type,
        family: f.familyId === null ? null : (familyName.get(f.familyId) ?? null),
        season: f.season,
        timeOfDay: f.timeOfDay,
        sillage: f.sillage,
        longevityRu: f.longevityRu,
        longevityUz: f.longevityUz,
        descriptionRu: f.descriptionRu,
        descriptionUz: f.descriptionUz,
        whenToWearRu: f.whenToWearRu,
        whenToWearUz: f.whenToWearUz,
        keyNotesRu: f.keyNotesRu,
        keyNotesUz: f.keyNotesUz,
        topNotes: level('top'),
        heartNotes: level('heart'),
        baseNotes: level('base'),
        similar: sims
          .filter((s) => s.fragranceId === f.id)
          .map((s) => codeById.get(s.similarId)!)
          .filter(Boolean),
        internalRemark: f.internalRemark ?? '',
        aliases: f.aliases,
        uzumUrl: f.uzumUrl ?? '',
        isHit: f.isHit,
        isNew: f.isNew,
        hidden: f.hidden,
        oilPrice: f.oilPrice,
        tier: f.tier,
        oilSupplier: f.oilSupplier ?? '',
        oilInvoice: f.oilInvoice ?? '',
      }),
    });
  }
  return {
    families: fam.map((f) => ({ id: f.id, nameRu: f.nameRu, nameUz: f.nameUz })),
    notes: nts.map((n) => ({ id: n.id, nameRu: n.nameRu, nameUz: n.nameUz })),
    byCode,
  };
}

const byRu = (a: DictionaryDraft, b: DictionaryDraft) => a.nameRu.localeCompare(b.nameRu, 'ru');

/** The export: the snapshot in the template's shape, ordered by internal code. */
export function snapshotToData(s: Snapshot): CatalogData {
  return {
    families: s.families.map(({ nameRu, nameUz }) => ({ nameRu, nameUz })).sort(byRu),
    notes: s.notes.map(({ nameRu, nameUz }) => ({ nameRu, nameUz })).sort(byRu),
    fragrances: [...s.byCode.values()]
      .sort((a, b) => a.draft.code.localeCompare(b.draft.code))
      .map((f) => ({
        draft: f.draft,
        volumes: [...f.volumes.values()]
          .sort((a, b) => a.ml - b.ml)
          .map(({ ml, price, salePrice, saleEndsOn, onHand }) => ({
            ml,
            price,
            salePrice,
            saleEndsOn,
            onHand,
          })),
      })),
  };
}

/**
 * What the dry run saw. «Применить» recomputes it under locks and refuses if it moved: a plan is
 * never written onto a catalog it was not computed against. Reserve is left out on purpose: it
 * only feeds warnings, and orders change it all day.
 */
export function fingerprint(s: Snapshot): string {
  const h = createHash('sha256');
  h.update(JSON.stringify([s.families, s.notes]));
  for (const f of [...s.byCode.values()].sort((a, b) => a.id - b.id)) {
    h.update(JSON.stringify([f.id, f.slug, f.draft, [...f.volumes.values()]]));
  }
  return h.digest('hex');
}
