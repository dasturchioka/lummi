'use client';

import {
  FRAGRANCE_START_PARAM,
  STATIC_START_TARGETS,
  bannerInputSchema,
  type AdminBanner,
} from '@lummi/contracts';
import { Check, ImageOff, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
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

/** The target list is `STATIC_START_TARGETS` plus the fragrance link; a new target there shows up here with no edit. */
const STATIC_KINDS = Object.keys(STATIC_START_TARGETS) as (keyof typeof STATIC_START_TARGETS)[];
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
              <Field id={`bn-title-${l}`} label={b.title} error={err(`title${S}`)}>
                <Input
                  value={draft[`title${S}` as keyof Draft]}
                  maxLength={60}
                  onChange={(e) => set(`title${S}` as keyof Draft, e.target.value as never)}
                />
              </Field>
              <Field id={`bn-sub-${l}`} label={b.subtitle} error={err(`subtitle${S}`)}>
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

/** The banner section of the «Контент» page: the list with on / off, and the editor with its live preview. */
export function BannerEditor({
  banners,
  t,
  language,
}: {
  banners: AdminBanner[];
  t: AdminMessages;
  language: 'ru' | 'uz';
}) {
  const b = t.content.banner;
  const router = useRouter();
  const [editing, setEditing] = useState<number | 'new' | null>(
    banners.length === 0 ? 'new' : null,
  );
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AdminBanner | null>(null);
  const current =
    typeof editing === 'number' ? (banners.find((x) => x.id === editing) ?? null) : null;
  const editorRef = useRef<HTMLDivElement>(null);
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
    if (res.status !== 200) setNotice(res.status === 422 ? b.needsPhoto : t.content.failed);
    router.refresh();
  };
  const remove = async (x: AdminBanner) => {
    const res = await browserApi.content.banners.remove({ params: { id: x.id } });
    setRemoving(null);
    if (res.status !== 200) setNotice(t.content.failed);
    if (editing === x.id) setEditing(null);
    router.refresh();
  };

  return (
    <Card className="grid gap-5 p-4 sm:p-6" data-section="banner">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{b.section}</h2>
          <p className="mt-1 max-w-[64ch] text-sm text-pretty text-muted-foreground">{b.hint}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => open('new')}>
          <Plus strokeWidth={1.5} aria-hidden />
          {b.add}
        </Button>
      </div>
      {banners.length === 0 ? (
        <p className="text-sm text-muted-foreground">{b.empty}</p>
      ) : (
        // One hairline row per banner, as the panel's other lists; the one open in the editor
        // below sits on Milk Field, so the list and the form read as one.
        <ul className="divide-y divide-border">
          {banners.map((x) => (
            <li key={x.id} className="py-1">
              <div
                aria-current={editing === x.id ? 'true' : undefined}
                className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-button px-2 py-2 transition-colors duration-150 aria-current:bg-field"
              >
                <div className="grid aspect-[3/4] h-14 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-field shadow-[inset_0_0_0_1px_var(--hairline)]">
                  {x.imageHash ? (
                    <img
                      src={photoUrl(x.imageHash, 400)}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <ImageOff
                      className="size-4 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="line-clamp-2 text-[15px] font-semibold [overflow-wrap:anywhere]">
                    {(language === 'uz' ? x.titleUz : x.titleRu) || b.untitled}
                  </p>
                  <div className="mt-1">
                    <Badge tone={x.active ? 'sage' : 'neutral'}>{x.active ? b.on : b.off}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => open(x.id)}>
                    {b.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === x.id}
                    onClick={() => void toggle(x)}
                  >
                    {x.active ? b.turnOff : b.turnOn}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(x)}>
                    {b.remove}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
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
