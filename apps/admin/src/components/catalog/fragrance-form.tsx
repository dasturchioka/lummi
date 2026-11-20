'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  DEFAULT_LONGEVITY,
  FRAGRANCE_TIERS,
  FRAGRANCE_TYPES,
  MAX_SIMILAR,
  SEASONS,
  SILLAGES,
  TIMES_OF_DAY,
  VOLUME_MLS,
  fragranceInputSchema,
  type DictionaryItem,
  type FragranceAdmin,
  type FragranceCosts,
  type FragranceInput,
} from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { ArrowDown, ArrowLeft, ArrowUp, Check, CircleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  useForm,
  type FieldError,
  type FieldErrors,
  type Resolver,
  type UseFormRegisterReturn,
} from 'react-hook-form';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ShownCountEdit } from '@/components/stock/shown-count-edit';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';
import { CostBlock } from './cost-block';
import { PhotoUpload } from './photo-upload';

type Level = 'top' | 'heart' | 'base';
const LEVELS: Level[] = ['top', 'heart', 'base'];
type Mls = (typeof VOLUME_MLS)[number];

const emptyVolume = (ml: Mls) => ({
  ml,
  price: 0,
  salePrice: null,
  saleEndsOn: null,
});

function toForm(f: FragranceAdmin | null): FragranceInput {
  const volumes = VOLUME_MLS.map((ml) => {
    const v = f?.volumes.find((x) => x.ml === ml);
    return v
      ? {
          ml,
          price: v.price,
          salePrice: v.salePrice,
          saleEndsOn: v.saleEndsOn,
        }
      : emptyVolume(ml);
  });
  if (!f) {
    return {
      name: '',
      originalBrand: '',
      type: 'unisex',
      familyId: null,
      season: 'all_year',
      timeOfDay: 'everyday',
      sillage: 'noticeable',
      longevityRu: DEFAULT_LONGEVITY.ru,
      longevityUz: DEFAULT_LONGEVITY.uz,
      descriptionRu: '',
      descriptionUz: '',
      whenToWearRu: '',
      whenToWearUz: '',
      keyNotesRu: ['', '', ''],
      keyNotesUz: ['', '', ''],
      internalRemark: '',
      aliases: [],
      uzumUrl: '',
      oilPrice: null,
      tier: null,
      oilSupplier: '',
      oilInvoice: '',
      isHit: false,
      isNew: false,
      hidden: false,
      notes: { top: [], heart: [], base: [] },
      similarIds: [],
      volumes,
      concentrateMl: 0,
    };
  }
  return {
    ...f,
    internalRemark: f.internalRemark ?? '',
    uzumUrl: f.uzumUrl ?? '',
    oilSupplier: f.oilSupplier ?? '',
    oilInvoice: f.oilInvoice ?? '',
    keyNotesRu: [0, 1, 2].map((i) => f.keyNotesRu[i] ?? ''),
    keyNotesUz: [0, 1, 2].map((i) => f.keyNotesUz[i] ?? ''),
    volumes,
    // the count the form loaded: the server writes a changed one only if it still holds (ADR 0043)
    concentrateMl: f.stock.concentrateMl,
    loadedConcentrateMl: f.stock.concentrateMl,
  };
}

/** Maps a form error to its RU/UZ text: our own codes first, then the zod rule that failed. */
function message(t: AdminMessages, e?: FieldError): string | undefined {
  if (!e) return undefined;
  const m = t.catalog.errors;
  switch (e.message) {
    case 'sale_below_price':
      return m.salePriceBelow;
    case 'end_without_sale':
      return m.endWithoutSale;
    case 'url':
      return m.url;
    case 'duplicate_note':
      return m.duplicateNote;
    case 'duplicate_similar':
      return m.duplicateSimilar;
    case 'duplicate_volume':
      return m.invalid;
    case 'server':
      return m.invalid;
  }
  if (e.type === 'too_small' || e.type === 'too_big')
    return e.message?.includes('exactly') ? m.keyNotes : m.required;
  if (e.type === 'invalid_type') return e.message === 'Required' ? m.required : m.number;
  return m.invalid;
}

// rhf also feeds setValueAs the default value (a number or null), not only typed strings
const num = (v: unknown) => (v === '' || v == null ? Number.NaN : Number(v));
const numOrNull = (v: unknown) => (v === '' || v == null ? null : Number(v));
/** Ml as typed: a comma is the decimal point. */
const decimal = (v: unknown) =>
  v === '' || v == null ? Number.NaN : Number(String(v).replace(/\s/g, '').replace(',', '.'));
/** A figure as the panel shows it: grouped digits, a decimal comma. */
const shown = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, '\u202f');
const textOrNull = (v: unknown) => (v ? String(v) : null);
/** A typed price read back with its thousands («1250000» -> «1 250 000 сум»), once it has some. */
const priceEcho = (v: unknown, language: Language) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1000
    ? formatMoney(v, language)
    : undefined;

/**
 * Create and edit a fragrance: every field, RU/UZ side by side, notes by level from the
 * dictionary, ordered similar fragrances, and the volume editor with a photo per volume.
 * Validation is the API's own zod schema (shared via contracts); the server checks it again.
 */
export function FragranceForm({
  initial,
  costs = null,
  costsFailed = false,
  families,
  notes,
  others,
  language,
  t,
}: {
  initial: FragranceAdmin | null;
  /** The saved volumes' unit costs (ADR 0040); refreshed with the page after a save. */
  costs?: FragranceCosts | null;
  /** The costs request failed (the cost block offers «Повторить»). */
  costsFailed?: boolean;
  families: DictionaryItem[];
  notes: DictionaryItem[];
  others: { id: number; name: string }[];
  language: Language;
  t: AdminMessages;
}) {
  const c = t.catalog;
  const router = useRouter();
  const [enabled, setEnabled] = useState<Record<Mls, boolean>>(() => ({
    10: initial ? initial.volumes.some((v) => v.ml === 10) : true,
    30: initial ? initial.volumes.some((v) => v.ml === 30) : true,
    50: initial ? initial.volumes.some((v) => v.ml === 50) : true,
  }));
  const [aliasText, setAliasText] = useState((initial?.aliases ?? []).join('\n'));
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [code, setCode] = useState(initial?.code ?? null);
  const [photos, setPhotos] = useState<Record<number, string | null>>(() =>
    Object.fromEntries((initial?.volumes ?? []).map((v) => [v.ml, v.photo])),
  );
  const volumeIds = useMemo(
    () => Object.fromEntries((initial?.volumes ?? []).map((v) => [v.ml, v.id])),
    [initial],
  );

  // Disabled volume slots are validated as blanks, so they never block a save.
  const resolver: Resolver<FragranceInput> = (values, ctx, opts) =>
    zodResolver(fragranceInputSchema)(
      {
        ...values,
        volumes: values.volumes.map((v) => (enabled[v.ml] ? v : emptyVolume(v.ml))),
      } as FragranceInput,
      ctx,
      opts,
    ) as ReturnType<Resolver<FragranceInput>>;

  const form = useForm<FragranceInput>({
    defaultValues: toForm(initial),
    resolver,
    mode: 'onTouched',
  });
  const { register, watch, setValue, handleSubmit, formState, setError } = form;
  const errors = formState.errors;
  const v = watch();
  const err = (e?: FieldError) => message(t, e);
  const noteError = (['top', 'heart', 'base'] as const)
    .map((l) => errors.notes?.[l] as FieldError | undefined)
    .find(Boolean) ?? (errors.notes as FieldError | undefined);
  const reg = (name: Parameters<typeof register>[0], opts?: Parameters<typeof register>[1]) =>
    register(name, opts) as UseFormRegisterReturn;

  const noteName = (n: DictionaryItem) => (language === 'uz' ? n.nameUz : n.nameRu);
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const setLevel = (level: Level, ids: number[]) =>
    setValue(`notes.${level}`, ids, { shouldDirty: true, shouldValidate: true });
  const setSimilar = (ids: number[]) =>
    setValue('similarIds', ids, { shouldDirty: true, shouldValidate: true });
  const move = (ids: number[], i: number, d: -1 | 1) => {
    const out = [...ids];
    const j = i + d;
    if (j < 0 || j >= out.length) return out;
    [out[i], out[j]] = [out[j]!, out[i]!];
    return out;
  };

  const submit = handleSubmit(
    async (values) => {
      setBanner(null);
      setPending(true);
      const body: FragranceInput = {
        ...values,
        volumes: values.volumes.filter((x) => enabled[x.ml]),
      };
      const res = await (
        initial
          ? browserApi.catalog.fragrances.update({ params: { id: initial.id }, body })
          : browserApi.catalog.fragrances.create({ body })
      ).catch(() => null);
      setPending(false);
      if (res && (res.status === 200 || res.status === 201)) {
        const saved = res.body as FragranceAdmin;
        if (!initial) {
          router.push(`/catalog/${saved.id}`);
          return;
        }
        form.reset(toForm(saved));
        setCode(saved.code);
        setBanner({ kind: 'ok', text: c.saved });
        router.refresh();
        return;
      }
      if (res?.status === 409 && (res.body as { code?: string }).code === 'concentrate_changed') {
        for (const f of (res.body as { fields?: string[] }).fields ?? [])
          setError(f as never, { type: 'server', message: 'server' });
        setBanner({ kind: 'error', text: c.onHandChanged });
      } else if (res?.status === 409 && (res.body as { code?: string }).code === 'try_again') {
        setBanner({ kind: 'error', text: c.tryAgain });
      } else if (res?.status === 409) {
        setError('name', { type: 'server', message: 'server' });
        setBanner({ kind: 'error', text: c.nameTaken });
      } else if (res?.status === 422) {
        for (const f of (res.body as { fields?: string[] }).fields ?? [])
          setError(f as never, { type: 'server', message: 'server' });
        setBanner({ kind: 'error', text: c.badReference });
      } else setBanner({ kind: 'error', text: t.errors.generic });
    },
    () => setBanner({ kind: 'error', text: c.fixErrors }),
  );

  const volumeErr = (i: number, key: 'price' | 'salePrice' | 'saleEndsOn') =>
    err(
      (errors.volumes as FieldErrors<FragranceInput['volumes']> | undefined)?.[i]?.[
        key
      ] as FieldError,
    );

  const pair = (
    base: 'longevity' | 'descriptionField' | 'whenToWear',
    label: string,
    kind: 'input' | 'text',
  ) => {
    const names =
      base === 'longevity'
        ? (['longevityRu', 'longevityUz'] as const)
        : base === 'whenToWear'
          ? (['whenToWearRu', 'whenToWearUz'] as const)
          : (['descriptionRu', 'descriptionUz'] as const);
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {names.map((n, i) => (
          <Field
            key={n}
            id={`f-${n}`}
            label={`${label} · ${i === 0 ? c.ru : c.uz}`}
            error={err(errors[n])}
            hint={base === 'longevity' && i === 0 ? c.longevityHint : undefined}
          >
            {kind === 'input' ? (
              <Input {...reg(n)} />
            ) : (
              <Textarea rows={base === 'whenToWear' ? 3 : 6} {...reg(n)} />
            )}
          </Field>
        ))}
      </div>
    );
  };

  return (
    // fields focused by a failed save scroll clear of the top bar and the sticky save bar
    // autofill off: a field named «name» must not offer the owner's own name
    <form
      onSubmit={submit}
      noValidate
      autoComplete="off"
      className="[&_:is(input,select,textarea)]:scroll-mt-24 [&_:is(input,select,textarea)]:scroll-mb-28"
    >
      <PageHeader
        title={initial ? initial.name : c.newTitle}
        description={code ? `${c.productCode}: ${code}. ${c.productCodeHint}` : undefined}
        actions={
          <div className="flex items-center gap-3">
            {initial?.hidden && <Badge>{c.hidden}</Badge>}
            <Button variant="outline" asChild>
              <Link href="/catalog">
                <ArrowLeft strokeWidth={1.5} aria-hidden />
                {c.back}
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4">
        <Section title={c.sectionMain}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="f-name" label={c.name} hint={c.nameHint} error={err(errors.name)}>
              <Input {...reg('name')} />
            </Field>
            <Field
              id="f-brand"
              label={c.originalBrand}
              hint={c.originalBrandHint}
              error={err(errors.originalBrand)}
            >
              <Input {...reg('originalBrand')} />
            </Field>
            <Field id="f-type" label={c.type} error={err(errors.type)}>
              <Select {...reg('type')}>
                {FRAGRANCE_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {c.options.type[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="f-family" label={c.family} error={err(errors.familyId)}>
              <Select {...reg('familyId', { setValueAs: (x: unknown) => (x ? Number(x) : null) })}>
                <option value="">{c.noFamily}</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {noteName(f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="f-season" label={c.season} error={err(errors.season)}>
              <Select {...reg('season')}>
                {SEASONS.map((x) => (
                  <option key={x} value={x}>
                    {c.options.season[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="f-time" label={c.timeOfDay} error={err(errors.timeOfDay)}>
              <Select {...reg('timeOfDay')}>
                {TIMES_OF_DAY.map((x) => (
                  <option key={x} value={x}>
                    {c.options.time[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="f-sillage" label={c.sillage} error={err(errors.sillage)}>
              <Select {...reg('sillage')}>
                {SILLAGES.map((x) => (
                  <option key={x} value={x}>
                    {c.options.sillage[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="f-uzum" label={c.uzumUrl} error={err(errors.uzumUrl)}>
              <Input type="url" inputMode="url" placeholder="https://" {...reg('uzumUrl')} />
            </Field>
          </div>
        </Section>

        <Section title={c.sectionTexts}>
          {pair('longevity', c.longevity, 'input')}
          {pair('descriptionField', c.descriptionField, 'text')}
          {pair('whenToWear', c.whenToWear, 'text')}
          <div>
            <p className="text-[12.5px] font-medium text-muted-foreground">{c.keyNotes}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.keyNotesHint}</p>
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              {(['Ru', 'Uz'] as const).map((lang) => (
                <div key={lang} className="grid gap-3">
                  {[0, 1, 2].map((i) => {
                    const key = `keyNotes${lang}` as 'keyNotesRu' | 'keyNotesUz';
                    return (
                      <Field
                        key={i}
                        id={`f-${key}-${i}`}
                        label={`${fill(c.keyNote, { n: String(i + 1) })} · ${lang === 'Ru' ? c.ru : c.uz}`}
                        error={err((errors[key] as FieldError[] | undefined)?.[i])}
                      >
                        <Input {...reg(`${key}.${i}`)} />
                      </Field>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <Field
            id="f-aliases"
            label={c.aliases}
            hint={c.aliasesHint}
            error={err(errors.aliases as FieldError | undefined)}
          >
            <Textarea
              rows={3}
              value={aliasText}
              onChange={(e) => {
                setAliasText(e.target.value);
                setValue(
                  'aliases',
                  e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  { shouldDirty: true, shouldValidate: true },
                );
              }}
            />
          </Field>
          <Field id="f-remark" label={c.internalRemark} hint={c.internalRemarkHint}>
            <Textarea rows={3} {...reg('internalRemark')} />
          </Field>
        </Section>

        <Section title={c.sectionNotes}>
          {noteError && <Notice title={err(noteError) ?? c.errors.invalid} />}
          {LEVELS.map((level) => {
            const label = { top: c.noteTop, heart: c.noteHeart, base: c.noteBase }[level];
            const ids = v.notes[level];
            return (
              <div key={level}>
                <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {ids.length === 0 && (
                    <li className="text-sm text-muted-foreground">{c.noNotes}</li>
                  )}
                  {ids.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() =>
                          setLevel(
                            level,
                            ids.filter((x) => x !== id),
                          )
                        }
                        className="group inline-flex h-9 max-w-full items-center gap-1.5 rounded-full bg-field pr-2.5 pl-3.5 text-left text-sm transition-[background-color,transform] duration-150 ease-out hover:bg-stone/60 active:scale-[0.97]"
                        aria-label={`${c.remove}: ${noteById.get(id) ? noteName(noteById.get(id)!) : id}`}
                      >
                        <span className="min-w-0 truncate">
                          {noteById.get(id) ? noteName(noteById.get(id)!) : id}
                        </span>
                        <X
                          className="size-3.5 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground"
                          strokeWidth={1.5}
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 max-w-sm">
                  <Select
                    aria-label={`${label}: ${c.addNote}`}
                    value=""
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      if (id) setLevel(level, [...ids, id]);
                    }}
                  >
                    <option value="">{c.addNote}</option>
                    {notes
                      .filter((n) => !v.notes[level].includes(n.id))
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {noteName(n)}
                        </option>
                      ))}
                  </Select>
                </div>
              </div>
            );
          })}
        </Section>

        <Section title={c.sectionSimilar}>
          <p className="text-sm text-muted-foreground">{c.similarHint}</p>
          {errors.similarIds && (
            <Notice title={err(errors.similarIds as FieldError) ?? c.errors.invalid} />
          )}
          {v.similarIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">{c.noSimilar}</p>
          ) : (
            <ol className="grid gap-1.5">
              {v.similarIds.map((id, i) => (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-button bg-field py-1 pr-1 pl-3.5 text-sm"
                >
                  <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 py-1.5 break-words">
                    {others.find((o) => o.id === id)?.name ?? id}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={c.moveUp}
                    disabled={i === 0}
                    onClick={() => setSimilar(move(v.similarIds, i, -1))}
                  >
                    <ArrowUp strokeWidth={1.5} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={c.moveDown}
                    disabled={i === v.similarIds.length - 1}
                    onClick={() => setSimilar(move(v.similarIds, i, 1))}
                  >
                    <ArrowDown strokeWidth={1.5} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={c.remove}
                    onClick={() => setSimilar(v.similarIds.filter((x) => x !== id))}
                  >
                    <X strokeWidth={1.5} />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {v.similarIds.length < MAX_SIMILAR && (
            <div className="max-w-sm">
              <Select
                aria-label={c.addSimilar}
                value=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) setSimilar([...v.similarIds, id]);
                }}
              >
                <option value="">{c.addSimilar}</option>
                {others
                  .filter((o) => !v.similarIds.includes(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
        </Section>

        <Section title={c.sectionVolumes}>
          {/* the rules once, not repeated under every volume column */}
          <ul className="-mt-2 grid gap-1 text-small text-pretty text-muted-foreground">
            {[c.salePriceHint, c.saleEndsOnHint, c.photoHint].map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          {/* three columns from 1024 px, split by hairlines (no box inside the card) */}
          <div className="grid divide-y divide-border lg:-mx-6 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            {VOLUME_MLS.map((ml, i) => {
              const on = enabled[ml];
              const locked = !!initial?.volumes.some((x) => x.ml === ml);
              const typed = v.volumes[i]!;
              return (
                <div
                  key={ml}
                  className="@container grid scroll-mt-24 content-start gap-4 py-5 first:pt-0 last:pb-0 lg:px-6 lg:py-0"
                  data-volume={ml}
                >
                  <div className="flex min-h-6 items-center justify-between gap-3">
                    <h3 className="text-[15px] font-semibold tabular-nums">
                      {ml} {c.ml}
                    </h3>
                    {/* a volume that is already sold stays: only a new one can be switched off */}
                    {!locked && (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-[18px] accent-graphite"
                          checked={on}
                          onChange={(e) => setEnabled((s) => ({ ...s, [ml]: e.target.checked }))}
                        />
                        {c.volumeEnabled}
                      </label>
                    )}
                  </div>
                  {on && (
                    <>
                      <Field
                        id={`f-price-${ml}`}
                        label={c.price}
                        hint={priceEcho(typed.price, language)}
                        error={volumeErr(i, 'price')}
                      >
                        <Input
                          inputMode="numeric"
                          className="tabular-nums"
                          {...reg(`volumes.${i}.price`, { setValueAs: num })}
                        />
                      </Field>
                      <Field
                        id={`f-sale-${ml}`}
                        label={c.salePrice}
                        hint={priceEcho(typed.salePrice, language)}
                        error={volumeErr(i, 'salePrice')}
                      >
                        <Input
                          inputMode="numeric"
                          className="tabular-nums"
                          {...reg(`volumes.${i}.salePrice`, { setValueAs: numOrNull })}
                        />
                      </Field>
                      <Field
                        id={`f-end-${ml}`}
                        label={c.saleEndsOn}
                        error={volumeErr(i, 'saleEndsOn')}
                      >
                        <Input
                          type="date"
                          className="tabular-nums"
                          {...reg(`volumes.${i}.saleEndsOn`, { setValueAs: textOrNull })}
                        />
                      </Field>
                      <PhotoUpload
                        slot={ml}
                        label={`${c.photo} ${ml} ${c.ml}`}
                        url={volumeIds[ml] ? `/api/admin/volumes/${volumeIds[ml]}/photo` : null}
                        hash={photos[ml] ?? null}
                        onUploaded={(a) =>
                          setPhotos((s) => ({ ...s, [ml]: (a as { photo: string }).photo }))
                        }
                        messages={c}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title={c.sectionCost}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="f-oil-price"
              label={c.oilPrice}
              hint={c.oilPriceHint}
              error={errors.oilPrice ? c.errors.oilPrice : undefined}
            >
              <Input
                inputMode="numeric"
                className="tabular-nums"
                {...reg('oilPrice', { setValueAs: numOrNull })}
              />
            </Field>
            <Field id="f-tier" label={c.tier} error={err(errors.tier)}>
              <Select {...reg('tier', { setValueAs: (x: unknown) => (x ? x : null) })}>
                <option value="">{c.noTier}</option>
                {FRAGRANCE_TIERS.map((x) => (
                  <option key={x} value={x}>
                    {c.options.tier[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="f-oil-supplier" label={c.oilSupplier} error={err(errors.oilSupplier)}>
              <Input {...reg('oilSupplier')} />
            </Field>
            <Field
              id="f-oil-invoice"
              label={c.oilInvoice}
              hint={c.oilInvoiceHint}
              error={err(errors.oilInvoice)}
            >
              <Input {...reg('oilInvoice')} />
            </Field>
          </div>
          <CostBlock
            costs={costs}
            failed={costsFailed}
            saved={!!initial}
            language={language}
            t={t}
          />
        </Section>

        <Section title={c.sectionStock}>
          <Field
            id="f-concentrate"
            label={c.concentrate}
            hint={c.concentrateHint}
            error={err(errors.concentrateMl)}
          >
            <Input
              inputMode="decimal"
              className="max-w-48 tabular-nums"
              {...reg('concentrateMl', { setValueAs: decimal })}
            />
          </Field>
          {initial && (
            <p className="-mt-2 text-small text-muted-foreground tabular-nums">
              {fill(c.reservedMl, { n: shown(initial.stock.reservedMl) })} ·{' '}
              {fill(c.bottlesNow, {
                list: initial.volumes
                  .map((x) => fill(c.bottle, { ml: String(x.ml), n: shown(x.available) }))
                  .join(' · '),
              })}
            </p>
          )}
          {initial && (v.concentrateMl ?? 0) < initial.stock.reservedMl && (
            <Notice title={c.belowReserve}>
              {fill(c.reservedMl, { n: shown(initial.stock.reservedMl) })}
            </Notice>
          )}
        </Section>

        <Section title={c.sectionFlags}>
          <Toggle label={c.isHit} hint={c.isHitHint} {...reg('isHit')} />
          <Toggle label={c.isNew} hint={c.isNewHint} {...reg('isNew')} />
          <Toggle label={c.hiddenLabel} hint={c.hiddenHint} {...reg('hidden')} />
        </Section>
          {initial && (
            <ShownCountEdit
              fragranceId={initial.id}
              name={initial.name}
              own={initial.shownCount}
              fallback={initial.shownDefault}
              max={initial.shownMax}
              idPrefix="shown-form"
              t={t}
            />
          )}
      </div>

      {/* the save bar: a Milk dock with a top hairline, edge to edge of the content column */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <Button type="submit" loading={pending} className="max-sm:w-full sm:min-w-40">
          {c.save}
        </Button>
        {banner && (
          <p
            key={banner.text}
            role={banner.kind === 'error' ? 'alert' : 'status'}
            className="flex min-w-0 flex-1 animate-[overlay-in_200ms_var(--ease-out)] items-start gap-2 text-sm leading-snug font-medium text-pretty"
          >
            {banner.kind === 'ok' ? (
              <Check
                className="mt-px size-4 shrink-0 text-sage-ink"
                strokeWidth={1.5}
                aria-hidden
              />
            ) : (
              <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.5} aria-hidden />
            )}
            {banner.text}
          </p>
        )}
      </div>
    </form>
  );
}

function Toggle({
  label,
  hint,
  ...props
}: { label: string; hint: string } & UseFormRegisterReturn) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-0.5 size-[18px] shrink-0 accent-graphite" {...props} />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-[13px] text-pretty text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
