'use client';

import {
  ACTIVE_BANNERS_MAX,
  FRAGRANCE_START_PARAM,
  START_TARGETS,
  bannerInputSchema,
  type AdminBanner,
  type BannerMoveDirection,
} from '@lummi/contracts';
import { fill } from '@lummi/i18n';
import { ArrowDown, ArrowUp, Check, ImageOff, Package, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { photoUrl } from '@/components/catalog/photo';
import { PhotoUpload } from '@/components/catalog/photo-upload';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { LangTabs } from './lang-tabs';
import { BannerPreview } from './banner-preview';
import { bannerTitle } from './banner-title';
import { SliderPreview, type DiscoverySlide } from './slider-preview';

/** The target list is `START_TARGETS` plus the fragrance link; a new target there shows up here with no edit. */
const STATIC_KINDS = START_TARGETS;
type Kind = string;
const FRAGRANCE = 'fragrance';

interface Draft {
  titleRu: string;
  titleUz: string;
  subtitleRu: string;
  subtitleUz: string;
  priceLineRu: string;
  priceLineUz: string;
  kind: Kind;
  slug: string;
}

const emptyDraft: Draft = {
  titleRu: '',
  titleUz: '',
  subtitleRu: '',
  subtitleUz: '',
  priceLineRu: '',
  priceLineUz: '',
  kind: 'catalog',
  slug: '',
};

function toDraft(b: AdminBanner | null): Draft {
  if (!b) return emptyDraft;
  const slug = FRAGRANCE_START_PARAM.exec(b.target)?.[1];
  return {
    titleRu: b.titleRu,
    titleUz: b.titleUz,
    subtitleRu: b.subtitleRu,
    subtitleUz: b.subtitleUz,
    priceLineRu: b.priceLineRu ?? '',
    priceLineUz: b.priceLineUz ?? '',
    kind: slug ? FRAGRANCE : b.target,
    slug: slug ?? '',
  };
}

const targetOf = (d: Draft) => (d.kind === FRAGRANCE ? `p_${d.slug.trim()}` : d.kind);

function toInput(d: Draft) {
  return {
    titleRu: d.titleRu,
    titleUz: d.titleUz,
    subtitleRu: d.subtitleRu,
    subtitleUz: d.subtitleUz,
    priceLineRu: d.priceLineRu.trim() === '' ? null : d.priceLineRu,
    priceLineUz: d.priceLineUz.trim() === '' ? null : d.priceLineUz,
    target: targetOf(d),
  };
}

function Form({
  banner,
  t,
  language,
  onSaved,
}: {
  banner: AdminBanner | null;
  t: AdminMessages;
  language: 'ru' | 'uz';
  onSaved: (b: AdminBanner) => void;
}) {
  const c = t.content;
  const b = c.banner;
  const [draft, setDraft] = useState<Draft>(() => toDraft(banner));
  const [saved, setSaved] = useState<AdminBanner | null>(banner);
  const [lang, setLang] = useState<'ru' | 'uz'>(language);
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'invalid'>('idle');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const err = (k: string) => (errors.has(k) ? c.required : undefined);
  const T = lang === 'ru' ? 'Ru' : 'Uz';
  const f = (base: 'title' | 'subtitle' | 'priceLine') => `${base}${T}` as keyof Draft;

  const save = async () => {
    const input = toInput(draft);
    const parsed = bannerInputSchema.safeParse(input);
    if (!parsed.success) {
      const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
      if (bad.delete('target')) bad.add(draft.kind === FRAGRANCE ? 'slug' : 'kind');
      setErrors(bad);
      setState('invalid');
      return;
    }
    setErrors(new Set());
    setState('saving');
    const res = saved
      ? await browserApi.content.banners.update({ params: { id: saved.id }, body: parsed.data })
      : await browserApi.content.banners.create({ body: parsed.data });
    const ok: AdminBanner | null =
      res.status === 200 || res.status === 201 ? (res.body as AdminBanner) : null;
    if (ok) {
      setSaved(ok);
      setDraft(toDraft(ok));
      setState('saved');
      onSaved(ok);
    } else {
      setState(res.status === 422 ? 'invalid' : 'failed');
    }
  };

  const preview = {
    imageHash: saved?.imageHash ?? null,
    title: (draft[f('title')] as string) || b.untitled,
    subtitle: draft[f('subtitle')] as string,
    priceLine: (draft[f('priceLine')] as string) || null,
  };

  return (
    // the preview column is a 390 px phone: the drawing inside is the banner's real 358 px
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,390px)] lg:items-start">
      <div className="order-first lg:order-last lg:sticky lg:top-6">
        <p className="mb-2 text-[12.5px] font-medium text-muted-foreground">{b.preview}</p>
        {/* on a phone the drawing takes the full width (a 360 px phone's banner); wider, it sits on a tray */}
        <div className="rounded-card sm:bg-field sm:p-4" data-banner-preview>
          <BannerPreview banner={preview} label={b.previewLabel} />
        </div>
      </div>
      <form
        className="grid gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <LangTabs
          value={lang}
          onChange={setLang}
          label={b.editing}
          labels={{ ru: c.langRu, uz: c.langUz }}
        />
        {/* Both languages stay mounted so a save always sends both; the tab shows one. */}
        {(['ru', 'uz'] as const).map((l) => {
          const S = l === 'ru' ? 'Ru' : 'Uz';
          return (
            <div key={l} hidden={lang !== l} lang={l} className="grid gap-4">
              <Field
                id={`bn-title-${l}`}
                label={b.title}
                hint={b.titleHint}
                error={err(`title${S}`)}
              >
                <Input
                  value={draft[`title${S}` as keyof Draft]}
                  maxLength={60}
                  onChange={(e) => set(`title${S}` as keyof Draft, e.target.value as never)}
                />
              </Field>
              <Field
                id={`bn-sub-${l}`}
                label={b.subtitle}
                hint={b.subtitleHint}
                error={err(`subtitle${S}`)}
              >
                {/* up to 160 characters: a field that grows, so the whole line stays in view */}
                <Textarea
                  rows={2}
                  className="min-h-0 resize-none"
                  value={draft[`subtitle${S}` as keyof Draft]}
                  maxLength={160}
                  onChange={(e) => set(`subtitle${S}` as keyof Draft, e.target.value as never)}
                  onKeyDown={(e) => {
                    // one line of text, as before: Enter saves instead of breaking the line
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }}
                />
              </Field>
              <Field id={`bn-price-${l}`} label={b.priceLine} hint={b.priceLineHint}>
                <Input
                  value={draft[`priceLine${S}` as keyof Draft]}
                  maxLength={40}
                  onChange={(e) => set(`priceLine${S}` as keyof Draft, e.target.value as never)}
                />
              </Field>
            </div>
          );
        })}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="bn-target" label={b.target}>
            <Select value={draft.kind} onChange={(e) => set('kind', e.target.value)}>
              {STATIC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {b.targets[k]}
                </option>
              ))}
              <option value={FRAGRANCE}>{b.targets.fragrance}</option>
            </Select>
          </Field>
          {draft.kind === FRAGRANCE && (
            <Field
              id="bn-slug"
              label={b.fragranceSlug}
              hint={b.fragranceSlugHint}
              error={err('slug')}
            >
              <Input
                value={draft.slug}
                maxLength={60}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => set('slug', e.target.value)}
              />
            </Field>
          )}
        </div>
        <PhotoUpload
          key={saved?.id ?? 'new'}
          slot="banner"
          label={t.catalog.photo}
          url={saved ? `/api/admin/content/banners/${saved.id}/photo` : null}
          hash={saved?.imageHash ?? null}
          hint={b.photoHint}
          messages={{ ...t.catalog, photoSaveFirst: b.photoSaveFirst }}
          onUploaded={(a) => {
            const nb = a as AdminBanner;
            setSaved(nb);
            onSaved(nb);
          }}
        />
        {(state === 'invalid' || state === 'failed') && (
          <Notice title={state === 'invalid' ? c.fixErrors : c.failed} />
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={state === 'saving'}>
            {state === 'saving' ? c.saving : c.save}
          </Button>
          {state === 'saved' && (
            <p role="status" className="flex items-center gap-1.5 text-sm font-medium">
              <Check className="size-4 text-sage-ink" strokeWidth={1.5} aria-hidden />
              {c.saved}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * A row's photo: the banner's own, or a hollow tile while it has none. The Discovery set without
 * the owner's photo shows a box: customers see the box photo the app ships with, nothing is missing.
 */
function Thumb({ hash, set = false }: { hash: string | null; set?: boolean }) {
  const Icon = set ? Package : ImageOff;
  return (
    <div className="grid aspect-[3/4] h-14 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-field shadow-[inset_0_0_0_1px_var(--hairline)]">
      {hash ? (
        <img src={photoUrl(hash, 400)} alt="" className="size-full object-cover" />
      ) : (
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      )}
    </div>
  );
}

/**
 * The slide number in front of a row, the same one the slider preview shows over the slide. A
 * screen reader hears «Слайд 2» (visually hidden text), the eye sees the number.
 */
function SlideNumber({ n, label }: { n: number; label: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-field text-[13px] font-semibold tabular-nums">
      <span aria-hidden="true">{n}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

const ROW =
  '-mx-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-button px-2 py-2 transition-colors duration-150 aria-current:bg-field';
const LIST_TITLE = 'text-[13px] font-semibold text-muted-foreground';

/**
 * The banner section of the «Контент» page (#62): the Home slider as customers swipe it, the
 * banners that are on in slider order (the Discovery set is always slide 1) with up / down, the
 * ones that are off, and the editor with its live preview. A move shows at once and the page
 * then reloads the order from the server; the moved row keeps the focus.
 */
export function BannerEditor({
  banners,
  discovery,
  t,
  language,
}: {
  /** The active banners first, in slider order, then the rest (the API's list order). */
  banners: AdminBanner[];
  discovery: DiscoverySlide | null;
  t: AdminMessages;
  language: 'ru' | 'uz';
}) {
  const b = t.content.banner;
  const router = useRouter();
  const [editing, setEditing] = useState<number | 'new' | null>(
    banners.length === 0 ? 'new' : null,
  );
  /** The banner whose on / off switch is on its way. */
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AdminBanner | null>(null);
  // a move shows at once; the server's order replaces it when the page reloads
  const [moved, setMoved] = useState<{ ids: number[]; from: AdminBanner[] } | null>(null);
  const refocus = useRef<{ id: number; direction: BannerMoveDirection } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const byId = new Map(banners.map((x) => [x.id, x]));
  const on =
    moved && moved.from === banners
      ? moved.ids.map((id) => byId.get(id)).filter((x): x is AdminBanner => !!x)
      : banners.filter((x) => x.active);
  const off = banners.filter((x) => !x.active);
  const full = on.length >= ACTIVE_BANNERS_MAX;
  const current =
    typeof editing === 'number' ? (banners.find((x) => x.id === editing) ?? null) : null;
  const editorRef = useRef<HTMLDivElement>(null);

  // React may move the pressed button's row in the DOM, which drops its focus: put it back (on
  // the other arrow when this one just became disabled at the end of the list), until the
  // server's order is in.
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    const find = (d: BannerMoveDirection) =>
      listRef.current?.querySelector<HTMLButtonElement>(
        `[data-move-id="${target.id}"][data-move="${d}"]`,
      );
    const other = target.direction === 'up' ? 'down' : 'up';
    const el = [find(target.direction), find(other)].find((x) => x && !x.disabled);
    if (el && document.activeElement !== el) el.focus();
    if (!moved || moved.from !== banners) refocus.current = null;
  }, [banners, moved]);

  /** Opens the editor and, when it lands out of sight (below the list on a phone), brings it up. */
  const open = (target: number | 'new') => {
    setEditing(target);
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top >= 0 && top < window.innerHeight * 0.6) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    });
  };

  const toggle = async (x: AdminBanner) => {
    setBusy(x.id);
    setNotice(null);
    const res = await browserApi.content.banners.setActive({
      params: { id: x.id },
      body: { active: !x.active },
    });
    setBusy(null);
    if (res.status === 422) {
      const limit = res.body.fields?.includes('limit');
      setNotice(limit ? fill(b.atLimit, { max: String(ACTIVE_BANNERS_MAX) }) : b.needsPhoto);
    } else if (res.status !== 200) setNotice(t.content.failed);
    router.refresh();
  };
  const move = async (x: AdminBanner, direction: BannerMoveDirection) => {
    const i = on.findIndex((y) => y.id === x.id);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= on.length) return;
    const ids = on.map((y) => y.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setMoved({ ids, from: banners });
    refocus.current = { id: x.id, direction };
    setNotice(null);
    const res = await browserApi.content.banners.move({
      params: { id: x.id },
      body: { direction },
    });
    if (res.status !== 200) {
      setMoved(null);
      setNotice(t.content.failed);
    }
    router.refresh();
  };
  const remove = async (x: AdminBanner) => {
    const res = await browserApi.content.banners.remove({ params: { id: x.id } });
    setRemoving(null);
    if (res.status !== 200) setNotice(t.content.failed);
    if (editing === x.id) setEditing(null);
    router.refresh();
  };

  const title = (x: AdminBanner) => bannerTitle(x, language, b.untitled);
  const actions = (x: AdminBanner) => (
    <>
      <Button variant="outline" size="sm" onClick={() => open(x.id)}>
        {b.edit}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        loading={busy === x.id}
        // at the cap a banner that is off cannot go on; the note above the list says why
        disabled={!x.active && full}
        onClick={() => void toggle(x)}
      >
        {x.active ? b.turnOff : b.turnOn}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setRemoving(x)}>
        {b.remove}
      </Button>
    </>
  );

  return (
    <Card className="grid gap-5 p-4 sm:p-6" data-section="banner">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{b.section}</h2>
          <p className="mt-1 max-w-[64ch] text-sm text-pretty text-muted-foreground">
            {fill(b.hint, { max: String(ACTIVE_BANNERS_MAX) })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => open('new')}>
          <Plus strokeWidth={1.5} aria-hidden />
          {b.add}
        </Button>
      </div>
      <SliderPreview banners={on} discovery={discovery} t={t} language={language} />
      <div ref={listRef} className="grid min-w-0 gap-5">
        <div className="grid gap-1">
          <h3 className={LIST_TITLE}>
            {fill(b.onList, { n: String(on.length), max: String(ACTIVE_BANNERS_MAX) })}
          </h3>
          {/* One hairline row per slide, as the panel's other lists; the one open in the editor
              below sits on Milk Field, so the list and the form read as one. */}
          <ol className="divide-y divide-border" data-banner-list="on">
            <li className="py-1">
              <div className={ROW}>
                <SlideNumber n={1} label={fill(b.slide, { n: '1' })} />
                <Thumb hash={discovery?.photo ?? null} set />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="font-name text-[19px] leading-tight font-medium italic">
                    Discovery set
                  </p>
                  <p className="mt-1 text-small text-muted-foreground">{b.discoveryFirst}</p>
                </div>
              </div>
            </li>
            {on.map((x, i) => (
              <li key={x.id} className="py-1">
                <div aria-current={editing === x.id ? 'true' : undefined} className={ROW}>
                  <SlideNumber n={i + 2} label={fill(b.slide, { n: String(i + 2) })} />
                  <Thumb hash={x.imageHash} />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="line-clamp-2 text-[15px] font-semibold [overflow-wrap:anywhere]">
                      {title(x)}
                    </p>
                    <div className="mt-1">
                      <Badge tone="sage">{b.on}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-9 px-0"
                        data-move-id={x.id}
                        data-move="up"
                        aria-label={`${b.moveUp}: ${title(x)}`}
                        title={b.moveUp}
                        disabled={i === 0}
                        onClick={() => void move(x, 'up')}
                      >
                        <ArrowUp strokeWidth={1.5} aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-9 px-0"
                        data-move-id={x.id}
                        data-move="down"
                        aria-label={`${b.moveDown}: ${title(x)}`}
                        title={b.moveDown}
                        disabled={i === on.length - 1}
                        onClick={() => void move(x, 'down')}
                      >
                        <ArrowDown strokeWidth={1.5} aria-hidden />
                      </Button>
                    </div>
                    {actions(x)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        {off.length > 0 || banners.length === 0 ? (
          <div className="grid gap-1">
            <h3 className={LIST_TITLE}>{b.offList}</h3>
            {full ? (
              <p className="max-w-[64ch] text-small text-pretty text-muted-foreground">
                {fill(b.atLimit, { max: String(ACTIVE_BANNERS_MAX) })}
              </p>
            ) : null}
            {banners.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{b.empty}</p>
            ) : (
              <ul className="divide-y divide-border" data-banner-list="off">
                {off.map((x) => (
                  <li key={x.id} className="py-1">
                    <div aria-current={editing === x.id ? 'true' : undefined} className={ROW}>
                      <Thumb hash={x.imageHash} />
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="line-clamp-2 text-[15px] font-semibold [overflow-wrap:anywhere]">
                          {title(x)}
                        </p>
                        <div className="mt-1">
                          <Badge tone="neutral">{b.off}</Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">{actions(x)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
      {notice && <Notice title={notice} />}
      {editing !== null && (
        <div
          ref={editorRef}
          className="grid scroll-mt-24 gap-4 border-t border-border pt-5 lg:scroll-mt-10"
        >
          <h3 className="text-[15px] font-semibold">
            {editing === 'new' ? b.creating : b.editing}
          </h3>
          <Form
            key={editing}
            banner={current}
            t={t}
            language={language}
            onSaved={(nb) => {
              if (editing === 'new') setEditing(nb.id);
              router.refresh();
            }}
          />
        </div>
      )}
      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{b.removeTitle}</AlertDialogTitle>
          <AlertDialogDescription>{b.removeText}</AlertDialogDescription>
          <DialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">{b.cancel}</Button>
            </AlertDialogCancel>
            <Button onClick={() => removing && void remove(removing)}>{b.remove}</Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
