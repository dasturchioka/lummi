import {
  KEY_NOTE_COUNT,
  MAX_CONCENTRATE_ML,
  MAX_OIL_PRICE,
  MAX_PRICE,
  dictionaryInputSchema,
  fragranceInputSchema,
  noteInputSchema,
  volumeInputSchema,
  type ImportChange,
  type ImportChangeField,
  type ImportIssue,
  type ImportStockRow,
} from '@lummi/contracts';
import { normalizeUzbek } from '@lummi/i18n';
import type { ZodIssue } from 'zod';
import { saleEndInstant } from '../admin/catalog-admin.service';
import { slugify } from '../catalog/slug';
import type {
  LABELS} from './workbook';
import {
  DICTIONARY_COLUMNS,
  FRAGRANCE_COLUMNS,
  KEY_NOTE_SEP,
  VOLUME_COLUMNS,
  headerOf,
  labelsOf,
  parseLabel,
  parseYesNo,
  splitList,
  type FragranceDraft,
  type FragranceKey,
  type RawRow,
  type RawWorkbook,
  type VolumeDraft,
  type VolumeKey,
} from './workbook';
import { contentOf, normDraft, sameDraft, sameVolume, type Snapshot } from './snapshot';

/** One fragrance the file writes (new or changed), with every volume it ends up with. */
export interface FragranceOp {
  code: string;
  /** The Excel row of the fragrance (or of its first volume when only volumes are in the file). */
  row: number;
  existingId: number | null;
  /** Its `concentrateMl` is what the fragrance ends up with (ADR 0043). */
  draft: FragranceDraft & { concentrateMl: number };
  /** The concentrate the dry run saw (compare-and-set, as the form's); null for a new fragrance. */
  loadedConcentrateMl: number | null;
  volumes: VolumeDraft[];
}
export interface DictionaryOp {
  nameRu: string;
  nameUz: string;
  existingId: number | null;
}
export interface Plan {
  errors: ImportIssue[];
  warnings: ImportIssue[];
  stock: Omit<ImportStockRow, 'reservedMl' | 'availableMl' | 'negative'>[];
  changes: ImportChange[];
  counts: {
    fragrances: { new: number; changed: number; unchanged: number; notInFile: number };
    volumes: { new: number; changed: number; unchanged: number };
    families: { new: number; changed: number };
    notes: { new: number; changed: number };
  };
  families: DictionaryOp[];
  notes: DictionaryOp[];
  fragrances: FragranceOp[];
}

export interface PlanOptions {
  /** Today in Tashkent as `YYYY-MM-DD`, for the «скидка закончилась» warning. */
  today: string;
  /**
   * The seed loads the guide onto a catalog that may already have been edited: an existing
   * fragrance keeps its aliases, flags, Uzum link, prices, markdowns and concentrate.
   */
  seed?: boolean;
}

type Frag = RawRow<FragranceKey>;

/** Digits only; leading zeros come back (Excel turns «007» into 7). */
export function normaliseCode(text: string): string | null {
  const t = text.trim();
  if (!/^\d{1,6}$/.test(t)) return null;
  return t.padStart(3, '0');
}

const integer = (text: string): number | null => {
  const t = text.replace(/[\s\u00a0\u202f]/g, '');
  return /^\d{1,12}$/.test(t) ? Number(t) : null;
};
/** Ml to the microlitre: «1 234,5» or «1234.5». */
const millilitres = (text: string): number | null => {
  const t = text.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  return /^\d{1,12}(\.\d{1,3})?$/.test(t) ? Number(t) : null;
};

function dateText(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  else if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  } else return null;
  if (!saleEndInstant(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`)) {
    return null;
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Zod's wording to ours: the same rules as the admin form, reported on the file's own columns. */
const GROUP_ORDER = { price: 0, stock: 1, content: 2 } as const;
/** Prices and markdowns first, then stock, then content; the file's order within each. */
export const sortChanges = (changes: ImportChange[]) =>
  [...changes].sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.row - b.row);

function volumeFields(old: VolumeDraft | null, now: VolumeDraft): ImportChangeField[] {
  const out: ImportChangeField[] = [];
  for (const field of ['price', 'salePrice', 'saleEndsOn'] as const) {
    const before = old ? old[field] : null;
    if (!old || before !== now[field]) out.push({ field, before, after: now[field] });
  }
  return out;
}

function draftFields(old: FragranceDraft, now: FragranceDraft): ImportChangeField[] {
  const a = contentOf(old) as unknown as Record<string, ImportChangeField['before']>;
  const b = contentOf(now) as unknown as Record<string, ImportChangeField['before']>;
  return Object.keys(b)
    .filter(
      (k) => k !== 'code' && k !== 'concentrateMl' && JSON.stringify(a[k]) !== JSON.stringify(b[k]),
    )
    .map((field) => ({ field, before: a[field] ?? null, after: b[field] ?? null }));
}

function issueCode(i: ZodIssue): { code: string; params?: Record<string, string | number> } {
  if (i.code === 'custom') return { code: i.message };
  if (i.code === 'too_big') return { code: 'too_long', params: { max: Number(i.maximum) } };
  if (i.code === 'too_small') return { code: 'required' };
  if (i.message === 'url') return { code: 'bad_url' };
  return { code: 'invalid' };
}

export function planImport(
  raw: RawWorkbook,
  snap: Snapshot,
  opts: PlanOptions,
): Plan {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const seen = new Set<string>();
  const err = (
    sheet: ImportIssue['sheet'],
    row: number | null,
    column: string | null,
    code: string,
    params?: ImportIssue['params'],
  ) => {
    const key = `${sheet}|${row}|${column}|${code}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push({ sheet, row, column, code, ...(params ? { params } : {}) });
  };
  const fh = (k: FragranceKey) => headerOf(FRAGRANCE_COLUMNS, k);
  const vh = (k: VolumeKey) => headerOf(VOLUME_COLUMNS, k);

  const plan: Plan = {
    errors,
    warnings,
    stock: [],
    changes: [],
    counts: {
      fragrances: { new: 0, changed: 0, unchanged: 0, notInFile: 0 },
      volumes: { new: 0, changed: 0, unchanged: 0 },
      families: { new: 0, changed: 0 },
      notes: { new: 0, changed: 0 },
    },
    families: [],
    notes: [],
    fragrances: [],
  };
  if (raw.issues.length) {
    errors.push(...raw.issues);
    return plan;
  }

  // ---- dictionaries ----
  const dictionary = (
    kind: 'families' | 'notes',
    rows: RawRow<'nameRu' | 'nameUz'>[],
    existing: Snapshot['families'],
  ) => {
    const ruH = headerOf(DICTIONARY_COLUMNS, kind === 'families' ? 'familyRu' : 'noteRu');
    const uzH = headerOf(DICTIONARY_COLUMNS, kind === 'families' ? 'familyUz' : 'noteUz');
    const canon = new Map(existing.map((e) => [e.nameRu.toLowerCase(), e]));
    const inFile = new Map<string, number>();
    const ops: DictionaryOp[] = [];
    const finalNames = new Map(existing.map((e) => [e.nameRu.toLowerCase(), e.nameUz]));
    for (const r of rows) {
      const nameRu = r.cells.nameRu.trim();
      const nameUz = normalizeUzbek(r.cells.nameUz.trim());
      // the dictionary form's own rules (required, length, no comma in a note name)
      const parsedName = (kind === 'notes' ? noteInputSchema : dictionaryInputSchema).safeParse({
        nameRu,
        nameUz,
        aliases: [],
      });
      let valid = true;
      if (!parsedName.success) {
        for (const i of parsedName.error.issues) {
          const col = i.path[0] === 'nameUz' ? uzH : ruH;
          const { code, params } = issueCode(i);
          err('dictionary', r.row, col, code, params);
          valid = false;
        }
      }
      if (!valid) continue;
      if (!nameRu || !nameUz) continue;
      const key = nameRu.toLowerCase();
      const first = inFile.get(key);
      if (first !== undefined) {
        err('dictionary', r.row, ruH, 'duplicate_value', { row: first });
        continue;
      }
      inFile.set(key, r.row);
      const have = canon.get(key);
      if (have) {
        // the stored spelling is the key; a different case in the file is the same entry
        if (have.nameUz !== nameUz) {
          ops.push({ nameRu: have.nameRu, nameUz, existingId: have.id });
          finalNames.set(key, nameUz);
        }
      } else {
        ops.push({ nameRu, nameUz, existingId: null });
        finalNames.set(key, nameUz);
      }
    }
    if (kind === 'families') {
      // families.name_uz is unique in the database
      const owner = new Map<string, string>();
      for (const [ru, uz] of finalNames) {
        const prev = owner.get(uz);
        if (prev !== undefined) {
          const row = rows.find((r) => r.cells.nameRu.trim().toLowerCase() === ru)?.row ?? null;
          err('dictionary', row, uzH, 'duplicate_value', { value: uz });
        }
        owner.set(uz, ru);
      }
    }
    return { ops, canon, finalNames };
  };
  const fam = dictionary('families', raw.families, snap.families);
  const nts = dictionary('notes', raw.notes, snap.notes);
  plan.families = fam.ops;
  plan.notes = nts.ops;
  for (const [kind, d] of [
    ['families', fam],
    ['notes', nts],
  ] as const) {
    plan.counts[kind] = {
      new: d.ops.filter((o) => o.existingId === null).length,
      changed: d.ops.filter((o) => o.existingId !== null).length,
    };
  }
  const familyNames = new Map<string, string>(); // lower -> canonical RU
  for (const f of snap.families) familyNames.set(f.nameRu.toLowerCase(), f.nameRu);
  for (const o of fam.ops) familyNames.set(o.nameRu.toLowerCase(), o.nameRu);
  const noteNames = new Map<string, string>();
  for (const n of snap.notes) noteNames.set(n.nameRu.toLowerCase(), n.nameRu);
  for (const o of nts.ops) noteNames.set(o.nameRu.toLowerCase(), o.nameRu);

  // ---- fragrance rows ----
  const fileFragrances = new Map<string, { row: number; draft: FragranceDraft }>();
  const codesInFile = new Set<string>();
  const firstRow = new Map<string, number>();
  for (const r of raw.fragrances) {
    const code = normaliseCode(r.cells.code);
    if (r.cells.code.trim() === '') err('fragrances', r.row, fh('code'), 'required');
    else if (!code) err('fragrances', r.row, fh('code'), 'bad_code');
    if (code) {
      const dup = firstRow.get(code);
      if (dup !== undefined) {
        err('fragrances', r.row, fh('code'), 'duplicate_code', { row: dup });
        continue;
      }
      firstRow.set(code, r.row);
      codesInFile.add(code);
    }
  }
  for (const r of raw.volumes) {
    const code = normaliseCode(r.cells.code);
    if (code && !snap.byCode.has(code) && !codesInFile.has(code)) {
      err('volumes', r.row, vh('code'), 'unknown_code', { code });
    }
  }

  const known = (code: string) => snap.byCode.has(code) || codesInFile.has(code);
  for (const r of raw.fragrances) {
    const code = normaliseCode(r.cells.code);
    if (!code || firstRow.get(code) !== r.row) continue;
    const draft = parseFragrance(r, code, { familyNames, noteNames, known }, err, fh);
    if (draft) fileFragrances.set(code, { row: r.row, draft });
  }

  // ---- volume rows ----
  const fileVolumes = new Map<string, Map<number, { row: number; vol: VolumeDraft }>>();
  for (const r of raw.volumes) {
    const code = normaliseCode(r.cells.code);
    if (r.cells.code.trim() === '') err('volumes', r.row, vh('code'), 'required');
    else if (!code) err('volumes', r.row, vh('code'), 'bad_code');
    const vol = parseVolume(r, err, vh);
    if (!code || !vol || !known(code)) continue;
    const mine = fileVolumes.get(code) ?? new Map();
    const dup = mine.get(vol.ml);
    if (dup) {
      err('volumes', r.row, vh('ml'), 'duplicate_volume', { row: dup.row });
      continue;
    }
    mine.set(vol.ml, { row: r.row, vol });
    fileVolumes.set(code, mine);
    if (vol.saleEndsOn && vol.saleEndsOn < opts.today) {
      warnings.push({
        sheet: 'volumes',
        row: r.row,
        column: vh('saleEndsOn'),
        code: 'sale_ended',
        params: { date: vol.saleEndsOn },
      });
    }
  }

  // ---- put them together ----
  const newSlugs = new Set<string>();
  const existingSlugs = new Set([...snap.byCode.values()].map((f) => f.slug));
  const targets = new Set([...fileFragrances.keys(), ...fileVolumes.keys()]);
  for (const code of [...targets].sort()) {
    const existing = snap.byCode.get(code) ?? null;
    const inFile = fileFragrances.get(code) ?? null;
    let draft = inFile?.draft ?? existing?.draft;
    if (!draft) continue; // a bad fragrance row: its errors are already listed
    if (existing) {
      // A cost column the file leaves out keeps what is stored; so does the seed, over a value
      // the owner already set (ADR 0040).
      const keep = <K extends 'oilPrice' | 'tier' | 'oilSupplier' | 'oilInvoice'>(k: K) => {
        const stored = existing.draft[k];
        const set = stored !== null && stored !== '';
        return raw.absent.includes(k) || (opts.seed && set) ? stored : draft![k];
      };
      draft = {
        ...draft,
        oilPrice: keep('oilPrice'),
        tier: keep('tier'),
        oilSupplier: keep('oilSupplier'),
        oilInvoice: keep('oilInvoice'),
      };
    }
    if (opts.seed && existing) {
      draft = {
        ...draft,
        aliases: existing.draft.aliases.length ? existing.draft.aliases : draft.aliases,
        isHit: existing.draft.isHit,
        isNew: existing.draft.isNew,
        hidden: existing.draft.hidden,
        uzumUrl: existing.draft.uzumUrl,
      };
    }
    const mine = fileVolumes.get(code) ?? new Map();
    const row = inFile?.row ?? [...mine.values()][0]?.row ?? 0;

    // The ready concentrate (ADR 0043): the file's count, else (an empty cell, no column, the
    // seed over a loaded catalog) what is stored; a new fragrance starts at 0.
    const stored = existing ? (existing.draft.concentrateMl ?? 0) : null;
    const fileMl = inFile?.draft.concentrateMl ?? null;
    const concentrateMl = stored === null ? (fileMl ?? 0) : opts.seed ? stored : (fileMl ?? stored);
    const stockChange = stored === null ? concentrateMl > 0 : concentrateMl !== stored;
    if (inFile && (stored === null || stockChange))
      plan.stock.push({
        row: inFile.row,
        code,
        name: draft.name,
        concentrateMl: stored,
        newConcentrateMl: concentrateMl,
      });
    if (existing && stockChange)
      plan.changes.push({
        kind: 'changed',
        group: 'stock',
        row,
        code,
        name: draft.name,
        ml: null,
        fields: [{ field: 'concentrateMl', before: stored, after: concentrateMl }],
      });

    // every volume the fragrance ends up with: what it has, overridden by the file
    const finals = new Map<number, VolumeDraft>();
    for (const [ml, v] of existing?.volumes ?? []) {
      finals.set(ml, { ml: v.ml, price: v.price, salePrice: v.salePrice, saleEndsOn: v.saleEndsOn });
    }
    let volumeChange = false;
    for (const [ml, { row: vrow, vol }] of mine) {
      const old = existing?.volumes.get(ml);
      if (old && opts.seed) {
        plan.counts.volumes.unchanged++;
        continue;
      }
      if (!old) {
        plan.counts.volumes.new++;
        volumeChange = true;
      } else if (sameVolume(old, vol)) {
        plan.counts.volumes.unchanged++;
      } else {
        plan.counts.volumes.changed++;
        volumeChange = true;
      }
      finals.set(ml, vol);
      if (!old || !sameVolume(old, vol)) {
        plan.changes.push({
          kind: old ? 'changed' : 'new',
          group: 'price',
          row: vrow,
          code,
          name: draft.name,
          ml,
          fields: volumeFields(old ?? null, vol),
        });
      }
    }
    if (!existing && finals.size === 0) {
      err('fragrances', row, fh('code'), 'need_a_volume');
      continue;
    }

    if (!existing) {
      const slug = slugify(draft.name);
      if (!slug) err('fragrances', row, fh('name'), 'bad_name');
      else if (existingSlugs.has(slug) || newSlugs.has(slug)) {
        err('fragrances', row, fh('name'), 'name_taken');
      } else newSlugs.add(slug);
    }
    const changed = !existing || !sameDraft(existing.draft, draft);
    if (inFile) {
      if (!existing) plan.counts.fragrances.new++;
      else if (changed) plan.counts.fragrances.changed++;
      else plan.counts.fragrances.unchanged++;
    }
    if (inFile && changed) {
      const fields = existing ? draftFields(existing.draft, draft) : [];
      plan.changes.push({
        kind: existing ? 'changed' : 'new',
        group: 'content',
        row,
        code,
        name: draft.name,
        ml: null,
        fields,
      });
    }
    if (changed || volumeChange || stockChange) {
      plan.fragrances.push({
        code,
        row,
        existingId: existing?.id ?? null,
        draft: { ...normDraft(draft), concentrateMl },
        loadedConcentrateMl: stored,
        volumes: [...finals.values()].sort((a, b) => a.ml - b.ml),
      });
    }
  }
  plan.counts.fragrances.notInFile = [...snap.byCode.keys()].filter(
    (c) => !fileFragrances.has(c),
  ).length;
  return plan;
}

type Err = (
  sheet: ImportIssue['sheet'],
  row: number | null,
  column: string | null,
  code: string,
  params?: ImportIssue['params'],
) => void;

function parseFragrance(
  r: Frag,
  code: string,
  refs: {
    familyNames: Map<string, string>;
    noteNames: Map<string, string>;
    known: (code: string) => boolean;
  },
  err: Err,
  fh: (k: FragranceKey) => string,
): FragranceDraft | null {
  const c = r.cells;
  let ok = true;
  const bad = (k: FragranceKey, code: string, params?: ImportIssue['params']) => {
    err('fragrances', r.row, fh(k), code, params);
    ok = false;
  };
  const required = (k: FragranceKey) => {
    if (c[k].trim() === '') {
      bad(k, 'required');
      return '';
    }
    return c[k].trim();
  };
  const option = <F extends keyof typeof LABELS>(k: FragranceKey, field: F) => {
    const text = required(k);
    if (!text) return null;
    const v = parseLabel(field, text);
    if (!v) bad(k, 'bad_option', { value: text, options: labelsOf(field).join(', ') });
    return v;
  };
  const flag = (k: FragranceKey) => {
    const v = parseYesNo(c[k]);
    if (v === null) {
      bad(k, 'bad_flag', { value: c[k] });
      return false;
    }
    return v;
  };
  const keyNotes = (k: 'keyNotesRu' | 'keyNotesUz') => {
    const text = required(k);
    if (!text) return [];
    const parts = splitList(text, text.includes('·') ? /·/ : /,/);
    if (parts.length !== KEY_NOTE_COUNT) bad(k, 'three_key_notes', { n: parts.length });
    return parts;
  };
  const noteList = (k: 'topNotes' | 'heartNotes' | 'baseNotes') =>
    splitList(c[k], /,/).flatMap((name) => {
      const canon = refs.noteNames.get(name.toLowerCase());
      if (!canon) {
        bad(k, 'unknown_note', { value: name });
        return [];
      }
      return [canon];
    });

  const name = required('name');
  const originalBrand = required('originalBrand');
  const type = option('type', 'type');
  const season = option('season', 'season');
  const timeOfDay = option('timeOfDay', 'timeOfDay');
  const sillage = option('sillage', 'sillage');
  let family: string | null = null;
  if (c.family.trim()) {
    family = refs.familyNames.get(c.family.trim().toLowerCase()) ?? null;
    if (!family) bad('family', 'unknown_family', { value: c.family.trim() });
  }
  let oilPrice: number | null = null;
  if (c.oilPrice.trim() !== '') {
    oilPrice = integer(c.oilPrice);
    if (oilPrice === null || oilPrice < 1) bad('oilPrice', 'bad_number', { value: c.oilPrice });
    else if (oilPrice > MAX_OIL_PRICE) bad('oilPrice', 'too_big', { max: MAX_OIL_PRICE });
  }
  let concentrateMl: number | null = null;
  if (c.concentrateMl.trim() !== '') {
    concentrateMl = millilitres(c.concentrateMl);
    if (concentrateMl === null) bad('concentrateMl', 'bad_number', { value: c.concentrateMl });
    else if (concentrateMl > MAX_CONCENTRATE_ML)
      bad('concentrateMl', 'too_big', { max: MAX_CONCENTRATE_ML });
  }
  let tier: keyof typeof LABELS.tier | null = null;
  if (c.tier.trim() !== '') {
    tier = parseLabel('tier', c.tier);
    if (!tier) bad('tier', 'bad_option', { value: c.tier.trim(), options: labelsOf('tier').join(', ') });
  }
  const similar: string[] = [];
  for (const raw of splitList(c.similar, /[,;]/)) {
    const s = normaliseCode(raw);
    if (!s || !refs.known(s)) bad('similar', 'unknown_similar', { value: raw });
    else if (s === code) bad('similar', 'self_similar');
    else if (similar.includes(s)) bad('similar', 'duplicate_similar', { value: s });
    else similar.push(s);
  }
  const draft = {
    code,
    name,
    originalBrand,
    type,
    family,
    season,
    timeOfDay,
    sillage,
    longevityRu: required('longevityRu'),
    longevityUz: required('longevityUz'),
    descriptionRu: required('descriptionRu'),
    descriptionUz: required('descriptionUz'),
    whenToWearRu: required('whenToWearRu'),
    whenToWearUz: required('whenToWearUz'),
    keyNotesRu: keyNotes('keyNotesRu'),
    keyNotesUz: keyNotes('keyNotesUz'),
    topNotes: noteList('topNotes'),
    heartNotes: noteList('heartNotes'),
    baseNotes: noteList('baseNotes'),
    similar,
    internalRemark: c.internalRemark.trim(),
    aliases: splitList(c.aliases, /[,;]/),
    uzumUrl: c.uzumUrl.trim(),
    isHit: flag('isHit'),
    isNew: flag('isNew'),
    hidden: flag('hidden'),
    oilPrice,
    tier,
    oilSupplier: c.oilSupplier.trim(),
    oilInvoice: c.oilInvoice.trim(),
    concentrateMl,
  };
  if (!ok) return null;
  const d = normDraft(draft as FragranceDraft);

  // The admin form's own rules (lengths, URL, duplicates), on synthetic ids.
  const idOf = (list: string[]) => new Map(list.map((n, i) => [n, i + 1]));
  const allNotes = idOf([...refs.noteNames.values()]);
  const dummyVolume = { ml: 10, price: 1, salePrice: null, saleEndsOn: null };
  const parsed = fragranceInputSchema.safeParse({
    name: d.name,
    originalBrand: d.originalBrand,
    type: d.type,
    familyId: d.family ? 1 : null,
    season: d.season,
    timeOfDay: d.timeOfDay,
    sillage: d.sillage,
    longevityRu: d.longevityRu,
    longevityUz: d.longevityUz,
    descriptionRu: d.descriptionRu,
    descriptionUz: d.descriptionUz,
    whenToWearRu: d.whenToWearRu,
    whenToWearUz: d.whenToWearUz,
    keyNotesRu: d.keyNotesRu,
    keyNotesUz: d.keyNotesUz,
    internalRemark: d.internalRemark || null,
    aliases: d.aliases,
    uzumUrl: d.uzumUrl || null,
    oilPrice: d.oilPrice,
    tier: d.tier,
    oilSupplier: d.oilSupplier || null,
    oilInvoice: d.oilInvoice || null,
    isHit: d.isHit,
    isNew: d.isNew,
    hidden: d.hidden,
    notes: {
      top: d.topNotes.map((n) => allNotes.get(n)),
      heart: d.heartNotes.map((n) => allNotes.get(n)),
      base: d.baseNotes.map((n) => allNotes.get(n)),
    },
    similarIds: d.similar.map((_, i) => i + 1),
    volumes: [dummyVolume],
  });
  if (!parsed.success) {
    const column = (i: ZodIssue): FragranceKey | null => {
      const head = i.path[0];
      switch (head) {
        case 'notes':
          return i.message === 'duplicate_note'
            ? ({ top: 'topNotes', heart: 'heartNotes', base: 'baseNotes' } as const)[
                String(i.path[1]) as 'top' | 'heart' | 'base'
              ]
            : null;
        case 'similarIds':
          return 'similar';
        case 'volumes':
          return null;
        case 'keyNotesRu':
        case 'keyNotesUz':
          return head;
        default:
          return FRAGRANCE_COLUMNS.some((x) => x.key === head) ? (head as FragranceKey) : null;
      }
    };
    for (const i of parsed.error.issues) {
      const k = column(i);
      if (!k) continue;
      const { code: c2, params } = issueCode(i);
      const three = (k === 'keyNotesRu' || k === 'keyNotesUz') && i.path.length === 1;
      err('fragrances', r.row, fh(k), three ? 'three_key_notes' : c2, params);
      ok = false;
    }
    if (!ok) return null;
  }
  return d;
}

function parseVolume(
  r: RawRow<VolumeKey>,
  err: Err,
  vh: (k: VolumeKey) => string,
): VolumeDraft | null {
  const c = r.cells;
  let ok = true;
  const bad = (k: VolumeKey, code: string, params?: ImportIssue['params']) => {
    err('volumes', r.row, vh(k), code, params);
    ok = false;
  };
  const mlText = c.ml.replace(/\s*(мл|ml)\.?$/i, '');
  const ml = integer(mlText);
  if (c.ml.trim() === '') bad('ml', 'required');
  else if (ml !== 10 && ml !== 30 && ml !== 50) bad('ml', 'bad_ml', { value: c.ml });
  const money = (k: 'price' | 'salePrice', optional: boolean) => {
    if (c[k].trim() === '') {
      if (!optional) bad(k, 'required');
      return null;
    }
    const n = integer(c[k]);
    if (n === null) bad(k, 'bad_number', { value: c[k] });
    else if (n > MAX_PRICE) bad(k, 'too_big', { max: MAX_PRICE });
    return n;
  };
  const price = money('price', false);
  const salePrice = money('salePrice', true);
  let saleEndsOn: string | null = null;
  if (c.saleEndsOn.trim() !== '') {
    saleEndsOn = dateText(c.saleEndsOn);
    if (!saleEndsOn) bad('saleEndsOn', 'bad_date', { value: c.saleEndsOn });
  }
  if (!ok || price === null) return null;
  // the sale rules of the admin form: below the price, an end only with a sale
  const parsed = volumeInputSchema.safeParse({ ml, price, salePrice, saleEndsOn });
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const k = i.path[0] as VolumeKey | undefined;
      if (k && VOLUME_COLUMNS.some((x) => x.key === k)) bad(k, issueCode(i).code);
    }
    return null;
  }
  return { ml: ml as 10 | 30 | 50, price, salePrice, saleEndsOn };
}

export { KEY_NOTE_SEP };
