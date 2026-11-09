'use client';

import {
  MAX_PHOTO_BYTES,
  STATIC_START_TARGETS,
  bannerInputSchema,
  type AdminBanner,
} from '@lummi/contracts';
import { Check, CircleAlert, ImageOff, ImagePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { photoUrl } from '@/components/catalog/photo';
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
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { LangTabs } from './lang-tabs';
import { BannerPreview } from './banner-preview';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const STATIC_KINDS = Object.keys(STATIC_START_TARGETS) as (keyof typeof STATIC_START_TARGETS)[];
type Kind = (typeof STATIC_KINDS)[number] | 'fragrance';

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
  const isFragrance = b.target.startsWith('p_');
  return {
    titleRu: b.titleRu,
    titleUz: b.titleUz,
    subtitleRu: b.subtitleRu,
    subtitleUz: b.subtitleUz,
    priceLineRu: b.priceLineRu ?? '',
    priceLineUz: b.priceLineUz ?? '',
    kind: isFragrance ? 'fragrance' : (b.target as Kind),
    slug: isFragrance ? b.target.slice(2) : '',
  };
}

const targetOf = (d: Draft) => (d.kind === 'fragrance' ? `p_${d.slug.trim()}` : d.kind);

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

/** The photo slot of a saved banner: current rendition, a button, and the server's verdict. */
function BannerPhoto({
  id,
  hash,
  onUploaded,
  t,
}: {
  id: number | null;
  hash: string | null;
  onUploaded: (b: AdminBanner) => void;
  t: AdminMessages;
}) {
  const c = t.content.banner;
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; text?: string }>({
    kind: 'idle',
  });
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const pick = async (file: File | undefined) => {
    if (!file || id === null) return;
    if (!TYPES.includes(file.type)) return setState({ kind: 'error', text: c.photoBadType });
    if (file.size > MAX_PHOTO_BYTES) return setState({ kind: 'error', text: c.photoTooBig });
    setPreview(URL.createObjectURL(file));
    setState({ kind: 'busy', text: c.photoUploading });
    const res = await fetch(`/api/admin/content/banners/${id}/photo`, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    }).catch(() => null);
    if (res?.ok) {
      onUploaded((await res.json()) as AdminBanner);
      setState({ kind: 'ok', text: c.photoUploaded });
    } else {
      setPreview(null);
      setState({
        kind: 'error',
        text:
          res?.status === 413
            ? c.photoTooBig
            : res?.status === 415
              ? c.photoBadType
              : res?.status === 422
                ? c.photoTooSmall
                : c.photoFailed,
      });
    }
  };

  const shown = preview ?? (hash ? photoUrl(hash, 400) : null);
  const busy = state.kind === 'busy';
  return (
    <div className="grid gap-1.5" data-banner-photo>
      <p className="text-[12.5px] font-medium text-muted-foreground">{c.photo}</p>
      {id === null ? (
        <p className="text-xs text-pretty text-muted-foreground">{c.photoSaveFirst}</p>
      ) : (
        <div className="flex items-start gap-4">
          <div
            className={`grid aspect-[3/4] w-24 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-field transition-opacity duration-200 ${busy ? 'opacity-60' : ''}`}
          >
            {shown ? (
              <img src={shown} alt="" className="size-full object-cover" decoding="async" />
            ) : (
              <ImageOff className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            )}
          </div>
          <div className="grid min-w-0 content-start justify-items-start gap-2">
            <input
              ref={input}
              type="file"
              accept={TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-label={c.photo}
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={busy}
              onClick={() => input.current?.click()}
            >
              <ImagePlus strokeWidth={1.5} aria-hidden />
              {shown ? c.photoReplace : c.photoChoose}
            </Button>
            <p className="text-xs text-pretty text-muted-foreground">{c.photoHint}</p>
            {state.text && !busy && (
              <p
                key={state.text}
                role={state.kind === 'error' ? 'alert' : 'status'}
                className="flex items-start gap-1.5 text-xs leading-snug font-medium text-pretty"
              >
                {state.kind === 'error' ? (
                  <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                ) : (
                  <Check
                    className="size-3.5 shrink-0 text-sage-ink"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                )}
                {state.text}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
      if (bad.delete('target')) bad.add(draft.kind === 'fragrance' ? 'slug' : 'kind');
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
      <div className="order-first lg:order-last lg:sticky lg:top-6">
        <p className="mb-2 text-[12.5px] font-medium text-muted-foreground">{b.preview}</p>
        <div className="rounded-card bg-field p-4" data-banner-preview>
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
                <Input
                  value={draft[`subtitle${S}` as keyof Draft]}
                  maxLength={160}
                  onChange={(e) => set(`subtitle${S}` as keyof Draft, e.target.value as never)}
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
            <Select value={draft.kind} onChange={(e) => set('kind', e.target.value as Kind)}>
              {STATIC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {b.targets[k]}
                </option>
              ))}
              <option value="fragrance">{b.targets.fragrance}</option>
            </Select>
          </Field>
          {draft.kind === 'fragrance' && (
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
        <BannerPhoto
          key={saved?.id ?? 'new'}
          id={saved?.id ?? null}
          hash={saved?.imageHash ?? null}
          onUploaded={(nb) => {
            setSaved(nb);
            onSaved(nb);
          }}
          t={t}
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
        <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
          {b.add}
        </Button>
      </div>
      {banners.length === 0 ? (
        <p className="text-sm text-muted-foreground">{b.empty}</p>
      ) : (
        <ul className="grid gap-2">
          {banners.map((x) => (
            <li
              key={x.id}
              className="flex flex-wrap items-center gap-3 rounded-button bg-field p-2.5 pr-3"
            >
              <div className="grid aspect-[3/4] h-14 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-card">
                {x.imageHash ? (
                  <img src={photoUrl(x.imageHash, 400)} alt="" className="size-full object-cover" />
                ) : (
                  <ImageOff
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-[15px] font-semibold">
                  {language === 'uz' ? x.titleUz : x.titleRu}
                </p>
                <div className="mt-1">
                  <Badge tone={x.active ? 'sage' : 'neutral'}>{x.active ? b.on : b.off}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(x.id)}>
                  {b.edit}
                </Button>
                <Button
                  variant="outline"
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
            </li>
          ))}
        </ul>
      )}
      {notice && <Notice title={notice} />}
      {editing !== null && (
        <div className="grid gap-4 border-t border-border pt-5">
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
