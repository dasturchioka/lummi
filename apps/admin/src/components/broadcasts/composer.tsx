'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  BROADCAST_AUDIENCES,
  CAPTION_MAX,
  MAX_PHOTO_BYTES,
  STARTAPP_TARGETS,
  TEXT_MAX,
  broadcastBodySchema,
  copyWarnings,
  type AudienceCount,
  type BroadcastAudience,
  type BroadcastBody,
  type CopyWarning,
} from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  ImageOff,
  ImagePlus,
  RotateCw,
  Send,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm, type FieldError, type Resolver } from 'react-hook-form';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
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
import { MetaLine } from '@/components/ui/meta-line';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';
import { countOf, num } from './format';
import { PreviewLanguageSwitch, TelegramPreview } from './telegram-preview';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type Count = AudienceCount;
/** «Копия», «реплика»; emoji as they are, without quotes. */
const named = (w: CopyWarning) =>
  w.kind === 'emoji' ? w.matches.join(' ') : w.matches.map((m) => `«${m}»`).join(', ');
/** The recipient count of the chosen audience: what the confirmation states, so it is never stale. */
type Reach =
  | { state: 'ok'; audience: BroadcastAudience; count: Count }
  | { state: 'loading' | 'error'; audience: BroadcastAudience; previous?: Count };
type Banner = { kind: 'ok' | 'error'; text: string } | null;

/**
 * The owner's composer: RU and UZ text, an optional image and link button, the audience with a
 * live recipient count, a preview of the message as Telegram shows it, «Отправить себе» and
 * «Отправить клиентам» (behind a confirmation that names the audience, its language and its
 * size). The server checks everything again; here the checks only save a round trip.
 *
 * Wide screens put the preview in a sticky column beside the form; phones show it after the
 * audience, right before the two send buttons.
 */
export function BroadcastComposer({
  initialCount,
  language,
  t,
}: {
  initialCount: Count;
  language: Language;
  t: AdminMessages;
}) {
  const b = t.broadcasts;
  const router = useRouter();
  const form = useForm<BroadcastBody>({
    defaultValues: { textRu: '', textUz: '', imageKey: null, buttonTarget: null, audience: 'all' },
    resolver: zodResolver(broadcastBodySchema) as unknown as Resolver<BroadcastBody>,
    mode: 'onTouched',
  });
  const { register, watch, setValue, handleSubmit, formState, setError, getValues, trigger } = form;
  const v = watch();
  const errors = formState.errors;

  // the button's target: a fixed route, or a fragrance by its address (p_<slug>)
  const [kind, setKind] = useState<string>('');
  const [slug, setSlug] = useState('');
  const pickTarget = (nextKind: string, nextSlug: string) => {
    setKind(nextKind);
    setSlug(nextSlug);
    const target = nextKind === '' ? null : nextKind === 'fragrance' ? `p_${nextSlug}` : nextKind;
    setValue('buttonTarget', target, { shouldDirty: true, shouldValidate: formState.isSubmitted });
  };
  const slugBad = kind === 'fragrance' && !SLUG.test(slug);

  // the fragrance behind the typed slug, looked up once typing pauses (the send checks it again)
  const [lookup, setLookup] = useState<{
    slug: string;
    name: string | null;
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    if (kind !== 'fragrance' || !SLUG.test(slug)) return;
    let live = true;
    const timer = setTimeout(() => {
      browserApi.broadcasts
        .fragrance({ query: { slug } })
        .then((res) => {
          if (!live) return;
          if (res.status === 200) setLookup({ slug, name: res.body.name });
          else setLookup({ slug, name: null, failed: res.status !== 404 });
        })
        .catch(() => live && setLookup({ slug, name: null, failed: true }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, slug]);
  const fragrance: 'none' | 'loading' | 'found' | 'missing' | 'error' =
    kind !== 'fragrance' || slugBad
      ? 'none'
      : lookup?.slug !== slug
        ? 'loading'
        : lookup.failed
          ? 'error'
          : lookup.name
            ? 'found'
            : 'missing';
  const fragranceName = fragrance === 'found' ? lookup?.name : null;

  const message = (e?: FieldError): string | undefined => {
    if (!e) return undefined;
    const map: Record<string, string> = {
      required: b.errors.required,
      too_long: b.errors.tooLong,
      caption_too_long: b.errors.captionTooLong,
      target: kind === 'fragrance' ? b.errors.slug : b.errors.target,
    };
    return (e.message && map[e.message]) || e.message || b.errors.required;
  };

  // live recipient count for the chosen audience (the page renders with «all» already counted)
  const [reach, setReach] = useState<Reach>({
    state: 'ok',
    audience: 'all',
    count: initialCount,
  });
  const loadCount = useCallback((audience: BroadcastAudience) => {
    let live = true;
    setReach((r) => ({
      state: 'loading',
      audience,
      previous: r.state === 'ok' ? r.count : r.previous,
    }));
    browserApi.broadcasts
      .audience({ query: { audience } })
      .then((res) => {
        if (!live) return;
        setReach(
          res.status === 200
            ? { state: 'ok', audience, count: res.body }
            : { state: 'error', audience },
        );
      })
      .catch(() => live && setReach({ state: 'error', audience }));
    return () => {
      live = false;
    };
  }, []);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    return loadCount(v.audience);
  }, [v.audience, loadCount]);
  const count = reach.state === 'ok' && reach.audience === v.audience ? reach.count : null;
  // while the next audience is counted, the last count stays, dimmed, instead of a skeleton flash
  const shownCount = count ?? (reach.state === 'loading' ? (reach.previous ?? null) : null);

  // image: uploaded when picked; the key is what the form sends. The picked file shows at once,
  // dimmed until the server has it; a failed upload brings the previous image back.
  const input = useRef<HTMLInputElement>(null);
  const committed = useRef<string | null>(null);
  const [image, setImage] = useState<{ url: string; pending: boolean } | null>(null);
  const [imageState, setImageState] = useState<Banner | { kind: 'busy'; text: string }>(null);
  useEffect(
    () => () => {
      if (committed.current) URL.revokeObjectURL(committed.current);
    },
    [],
  );
  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type))
      return setImageState({ kind: 'error', text: b.imageBadType });
    if (file.size > MAX_PHOTO_BYTES) return setImageState({ kind: 'error', text: b.imageTooBig });
    const url = URL.createObjectURL(file);
    setImage({ url, pending: true });
    setImageState({ kind: 'busy', text: b.imageUploading });
    const res = await fetch('/api/admin/broadcasts/image', {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    }).catch(() => null);
    if (res?.ok) {
      const { key } = (await res.json()) as { key: string };
      if (committed.current) URL.revokeObjectURL(committed.current);
      committed.current = url;
      setImage({ url, pending: false });
      setValue('imageKey', key, { shouldDirty: true });
      setImageState(null);
      void trigger(['textRu', 'textUz']);
    } else {
      URL.revokeObjectURL(url);
      setImage(committed.current ? { url: committed.current, pending: false } : null);
      setImageState({
        kind: 'error',
        text:
          res?.status === 413
            ? b.imageTooBig
            : res?.status === 415
              ? b.imageRejected
              : b.imageFailed,
      });
    }
  };
  const removeImage = () => {
    if (committed.current) URL.revokeObjectURL(committed.current);
    committed.current = null;
    setImage(null);
    setImageState(null);
    setValue('imageKey', null, { shouldDirty: true });
    void trigger(['textRu', 'textUz']);
  };
  const uploading = imageState?.kind === 'busy';

  const limit = v.imageKey ? CAPTION_MAX : TEXT_MAX;

  // the preview follows the text being written; the switch picks it by hand. A one-language
  // audience locks it: the other version goes to nobody, so it is never shown as what they get.
  const [previewLang, setPreviewLang] = useState<Language>(language);
  const lockedLang = v.audience === 'all' ? null : v.audience;
  const shownLang = lockedLang ?? previewLang;

  // one line beside the buttons: «Отправить себе» went out, or why a send did not
  const [banner, setBanner] = useState<Banner>(null);

  // «Отправить себе»
  const [testing, setTesting] = useState(false);
  const sendTest = async () => {
    setBanner(null);
    if (!(await trigger(undefined, { shouldFocus: true })) || slugBad) {
      return setBanner({ kind: 'error', text: b.fixErrors });
    }
    setTesting(true);
    const res = await browserApi.broadcasts.test({ body: getValues() }).catch(() => null);
    setTesting(false);
    if (res?.status === 200) setBanner({ kind: 'ok', text: b.testSent });
    else if (res?.status === 502 && res.body.code === 'test_blocked')
      setBanner({ kind: 'error', text: b.testBlocked });
    else setBanner({ kind: 'error', text: b.testFailed });
  };

  // «Отправить клиентам»: validate, confirm with the audience size, send
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const review = handleSubmit(
    () => {
      if (slugBad) return setBanner({ kind: 'error', text: b.fixErrors });
      if (fragrance === 'missing') {
        // the server refuses it too; say so here instead of in a failed send
        setError('buttonTarget', { message: b.errors.slugUnknown }, { shouldFocus: true });
        return setBanner({ kind: 'error', text: b.fixErrors });
      }
      setBanner(null);
      setConfirming(true);
    },
    () => setBanner({ kind: 'error', text: b.fixErrors }),
  );
  const send = async () => {
    setSending(true);
    setBanner(null);
    const res = await browserApi.broadcasts.create({ body: getValues() }).catch(() => null);
    if (res?.status === 201) return router.push(`/broadcasts/${res.body.id}`);
    setSending(false);
    setConfirming(false);
    if (res?.status === 422) {
      for (const f of res.body.fields ?? []) {
        if (f === 'imageKey') setError('imageKey', { message: b.errors.imageMissing });
        if (f === 'buttonTarget') setError('buttonTarget', { message: b.errors.slugUnknown });
      }
      setBanner({ kind: 'error', text: b.fixErrors });
    } else setBanner({ kind: 'error', text: b.sendFailed });
  };

  const reachableCustomers = count ? countOf(language, count.reachable, b.customers) : null;
  const blockedCount = count ? count.total - count.reachable : 0;
  const shownBlocked = shownCount ? shownCount.total - shownCount.reachable : 0;

  const counter = (n: number) => {
    const over = n > limit;
    return (
      <span
        className={cn(
          'text-xs whitespace-nowrap tabular-nums',
          over
            ? 'font-semibold text-foreground'
            : n >= limit * 0.9
              ? 'text-foreground'
              : 'text-muted-foreground',
        )}
      >
        {fill(b.counter, { n: num(n), max: num(limit) })}
      </span>
    );
  };
  const warningsFor = (text: string) => {
    const list = copyWarnings(text);
    return list.length === 0 ? null : (
      <Notice title={b.warnings.title} className="py-3">
        {list.map((w) => fill(b.warnings[w.kind], { words: named(w) })).join(' ')}
      </Notice>
    );
  };
  // what the customers of this audience would read with a warning still on it, for the confirmation
  const sentTexts =
    v.audience === 'all' ? [v.textRu, v.textUz] : [v.audience === 'ru' ? v.textRu : v.textUz];
  const openWarnings = [
    ...new Set(sentTexts.flatMap((text) => copyWarnings(text).map(named))),
  ].join(', ');

  const shownText = shownLang === 'uz' ? v.textUz : v.textRu;
  const targetLabel =
    kind === ''
      ? null
      : kind === 'fragrance'
        ? slug
          ? fill(b.targetFragrance, { name: fragranceName ?? slug })
          : b.targets.fragrance
        : b.targets[kind as (typeof STARTAPP_TARGETS)[number]];

  return (
    <>
      <PageHeader
        title={b.newTitle}
        description={b.newDescription}
        actions={
          <Button variant="outline" asChild>
            <Link href="/broadcasts">
              <ArrowLeft strokeWidth={1.5} aria-hidden />
              {b.back}
            </Link>
          </Button>
        }
      />
      <form
        onSubmit={review}
        noValidate
        autoComplete="off"
        className="grid max-w-[46rem] gap-4 xl:max-w-none xl:grid-cols-[minmax(0,1fr)_21rem] xl:gap-x-6 [&_:is(input,select,textarea)]:scroll-mt-24"
      >
        <div className="grid min-w-0 gap-4 xl:col-start-1 xl:row-start-1">
          <Section title={b.sectionText}>
            <div className="grid gap-2.5">
              <Field
                id="bc-ru"
                label={b.textRu}
                hint={b.textHint}
                error={message(errors.textRu)}
                aside={counter(v.textRu.length)}
              >
                <Textarea
                  lang="ru"
                  rows={5}
                  {...register('textRu')}
                  onFocus={() => setPreviewLang('ru')}
                />
              </Field>
              {warningsFor(v.textRu)}
            </div>
            <div className="grid gap-2.5">
              <Field
                id="bc-uz"
                label={b.textUz}
                error={message(errors.textUz)}
                aside={counter(v.textUz.length)}
              >
                <Textarea
                  lang="uz"
                  rows={5}
                  {...register('textUz')}
                  onFocus={() => setPreviewLang('uz')}
                />
              </Field>
              {warningsFor(v.textUz)}
            </div>
          </Section>

          <Section title={b.sectionMedia}>
            <div className="grid gap-1.5" data-image>
              <p className="text-[12.5px] font-medium text-muted-foreground">{b.image}</p>
              <div className="flex flex-col gap-3 min-[400px]:flex-row min-[400px]:items-start min-[400px]:gap-4">
                {/* the whole picture (contain): Telegram shows it uncropped, whatever its shape */}
                <div
                  className={cn(
                    'grid aspect-[3/4] w-24 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-field transition-opacity duration-200',
                    image?.pending && 'opacity-60',
                  )}
                >
                  {image ? (
                    <img
                      src={image.url}
                      alt=""
                      className="size-full object-contain"
                      decoding="async"
                    />
                  ) : (
                    <span className="grid justify-items-center gap-1.5 px-2 text-center text-xs text-muted-foreground">
                      <ImageOff className="size-5" strokeWidth={1.5} aria-hidden />
                      {b.imageNone}
                    </span>
                  )}
                </div>
                <div className="grid min-w-0 content-start justify-items-start gap-2">
                  <input
                    ref={input}
                    type="file"
                    accept={IMAGE_TYPES.join(',')}
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={b.image}
                    onChange={(e) => {
                      void pickImage(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={uploading}
                      onClick={() => input.current?.click()}
                    >
                      <ImagePlus strokeWidth={1.5} aria-hidden />
                      {v.imageKey ? b.imageReplace : b.imageChoose}
                    </Button>
                    {v.imageKey && !uploading && (
                      <Button type="button" variant="ghost" size="sm" onClick={removeImage}>
                        <Trash2 strokeWidth={1.5} aria-hidden />
                        {b.imageRemove}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs leading-snug text-pretty text-muted-foreground">
                    {b.imageHint}
                  </p>
                  {(imageState?.kind === 'error' || errors.imageKey) && (
                    <p
                      key={imageState?.text ?? errors.imageKey?.message}
                      role="alert"
                      className="flex animate-[overlay-in_200ms_var(--ease-out)] items-start gap-1.5 text-xs leading-snug font-medium text-pretty"
                    >
                      <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                      {imageState?.kind === 'error' ? imageState.text : errors.imageKey?.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="bc-target"
                label={b.button}
                hint={b.buttonHint}
                error={
                  errors.buttonTarget && kind !== 'fragrance'
                    ? message(errors.buttonTarget)
                    : undefined
                }
              >
                <Select value={kind} onChange={(e) => pickTarget(e.target.value, slug)}>
                  <option value="">{b.buttonNone}</option>
                  {STARTAPP_TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {b.targets[target]}
                    </option>
                  ))}
                  <option value="fragrance">{b.targets.fragrance}</option>
                </Select>
              </Field>
              {kind === 'fragrance' && (
                <div className="grid content-start gap-1.5">
                  <Field
                    id="bc-slug"
                    label={b.fragranceSlug}
                    hint={fragrance === 'none' ? b.fragranceSlugHint : undefined}
                    error={
                      errors.buttonTarget?.message === b.errors.slugUnknown
                        ? b.errors.slugUnknown
                        : formState.isSubmitted && slugBad
                          ? b.errors.slug
                          : undefined
                    }
                  >
                    <Input
                      value={slug}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      onChange={(e) => pickTarget('fragrance', e.target.value.trim().toLowerCase())}
                    />
                  </Field>
                  {/* which fragrance the slug opens, once typing pauses */}
                  <p
                    role="status"
                    aria-live="polite"
                    className={cn(
                      'flex items-start gap-1.5 text-xs leading-snug text-pretty [overflow-wrap:anywhere]',
                      (fragrance === 'loading' || fragrance === 'error') && 'text-muted-foreground',
                      fragrance === 'found' && 'font-medium',
                      // the field already says it in its error line after a refused send
                      (fragrance === 'none' ||
                        (fragrance === 'missing' &&
                          errors.buttonTarget?.message === b.errors.slugUnknown)) &&
                        'sr-only',
                    )}
                  >
                    {fragrance === 'found' && (
                      <Check
                        className="size-3.5 shrink-0 text-sage-ink"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                    )}
                    {fragrance === 'missing' && (
                      <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                    )}
                    {fragrance === 'loading'
                      ? b.fragranceLooking
                      : fragrance === 'found'
                        ? fill(b.targetFragrance, { name: fragranceName ?? slug })
                        : fragrance === 'missing'
                          ? b.errors.slugUnknown
                          : fragrance === 'error'
                            ? b.fragranceLookupFailed
                            : ''}
                  </p>
                </div>
              )}
            </div>
          </Section>

          <Section title={b.audience}>
            {/* each option is one tap target the width of the card, washed while pressed */}
            <fieldset className="-mx-2.5 -my-2 grid gap-0.5">
              <legend className="sr-only">{b.audience}</legend>
              {BROADCAST_AUDIENCES.map((a) => (
                <label
                  key={a}
                  className="flex cursor-pointer touch-manipulation items-start gap-3 rounded-button px-2.5 py-2 transition-colors duration-150 select-none hover:bg-milk active:bg-field"
                >
                  <input
                    type="radio"
                    value={a}
                    className="mt-0.5 size-[18px] shrink-0 accent-graphite"
                    {...register('audience')}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{b.audiences[a]}</span>
                    <span className="block text-[13px] text-pretty text-muted-foreground">
                      {b.audienceHints[a]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div
              role="status"
              aria-live="polite"
              className="border-t border-border pt-4"
              data-audience-size
            >
              {shownCount ? (
                <div
                  aria-busy={!count || undefined}
                  className={cn('transition-opacity duration-200 ease-out', !count && 'opacity-50')}
                >
                  {!count && <span className="sr-only">{b.countLoading}</span>}
                  <p className="text-[17px] leading-snug font-semibold tabular-nums">
                    {b.reach}:{' '}
                    <span className="whitespace-nowrap">
                      {countOf(language, shownCount.reachable, b.customers)}
                    </span>
                  </p>
                  {shownBlocked > 0 && (
                    <p className="mt-1 text-[13px] text-pretty text-muted-foreground">
                      {fill(b.addresseesBlocked, { n: num(shownBlocked) })}
                    </p>
                  )}
                </div>
              ) : reach.state === 'error' ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p className="flex items-start gap-2 text-sm font-medium">
                    <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                    {b.countFailed}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => loadCount(v.audience)}
                  >
                    <RotateCw strokeWidth={1.5} aria-hidden />
                    {t.actions.retry}
                  </Button>
                </div>
              ) : null}
            </div>
          </Section>
        </div>

        <Section
          title={b.sectionPreview}
          className="min-w-0 xl:sticky xl:top-10 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start"
          action={
            <PreviewLanguageSwitch
              value={shownLang}
              onChange={setPreviewLang}
              only={lockedLang}
              label={b.previewLanguage}
            />
          }
        >
          <div className="grid gap-2">
            <TelegramPreview
              text={shownText}
              image={image?.url ?? null}
              button={v.buttonTarget !== null}
              language={shownLang}
              t={t}
              className="xl:max-h-[min(34rem,calc(100dvh-14rem))]"
            />
            {targetLabel && (
              <p className="text-xs leading-snug text-pretty text-muted-foreground [overflow-wrap:anywhere]">
                {fill(b.buttonTo, { target: targetLabel })}
              </p>
            )}
            {lockedLang && (
              <p className="text-xs leading-snug text-pretty text-muted-foreground">
                {b.previewLocked[lockedLang]}
              </p>
            )}
          </div>
        </Section>

        <div className="flex flex-col gap-3 pt-2 xl:col-start-1 xl:row-start-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* a disabled button says why (DESIGN.md): nobody in this audience can get it */}
            <Button type="submit" disabled={count?.reachable === 0}>
              {count?.reachable === 0 ? (
                b.sendNobody
              ) : (
                <>
                  <Send strokeWidth={1.5} aria-hidden />
                  {b.send}
                </>
              )}
            </Button>
            <Button type="button" variant="outline" loading={testing} onClick={sendTest}>
              {b.sendTest}
            </Button>
          </div>
          {banner && (
            <p
              key={banner.text}
              role={banner.kind === 'error' ? 'alert' : 'status'}
              className="flex min-w-0 flex-1 animate-[overlay-in_200ms_var(--ease-out)] items-start gap-2 text-sm leading-snug font-medium text-pretty sm:basis-64"
              data-test-status={banner.text === b.testSent ? '' : undefined}
            >
              {banner.kind === 'error' ? (
                <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              ) : (
                <Check
                  className="mt-px size-4 shrink-0 text-sage-ink"
                  strokeWidth={1.5}
                  aria-hidden
                />
              )}
              {banner.text}
            </p>
          )}
        </div>
      </form>

      <AlertDialog open={confirming} onOpenChange={(open) => !sending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogTitle>{b.sendTitle[v.audience]}</AlertDialogTitle>
          <AlertDialogDescription>{b.sendText}</AlertDialogDescription>
          <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-button bg-field px-4 py-3.5 text-sm leading-snug">
            <dt className="self-center text-muted-foreground">{b.reach}</dt>
            <dd className="text-[17px] font-semibold tabular-nums">
              {count ? (
                reachableCustomers
              ) : reach.state === 'error' ? (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm font-medium">
                  {b.countFailed}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => loadCount(v.audience)}
                  >
                    <RotateCw strokeWidth={1.5} aria-hidden />
                    {t.actions.retry}
                  </Button>
                </span>
              ) : (
                <span className="skeleton inline-block h-5 w-28 align-middle" />
              )}
            </dd>
            {blockedCount > 0 && (
              <>
                <dt className="text-muted-foreground">{b.unreachable}</dt>
                <dd className="text-pretty">
                  <span className="font-medium tabular-nums">{num(blockedCount)}</span>
                  <span className="text-muted-foreground">: {b.unreachableHint}</span>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{b.language}</dt>
            <dd className="text-pretty">
              {v.audience === 'all' && count && (
                <MetaLine
                  className="font-medium tabular-nums"
                  parts={(['ru', 'uz'] as const).map((l) => (
                    <span key={l} className="whitespace-nowrap">
                      {fill(b.languageSplit[l], { n: num(count.reachableByLanguage[l]) })}
                    </span>
                  ))}
                />
              )}
              <span className={cn(v.audience === 'all' && count && 'text-muted-foreground')}>
                {b.audienceHints[v.audience]}
              </span>
            </dd>
            {targetLabel && (
              <>
                <dt className="text-muted-foreground">{b.buttonShort}</dt>
                <dd className="text-pretty [overflow-wrap:anywhere]">{targetLabel}</dd>
              </>
            )}
          </dl>
          {openWarnings && (
            <p className="mt-3 flex items-start gap-2 text-[13px] leading-snug text-pretty [overflow-wrap:anywhere]">
              <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              {fill(b.warnings.confirm, { words: openWarnings })}
            </p>
          )}
          <DialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={sending}>
                {t.actions.cancel}
              </Button>
            </AlertDialogCancel>
            <Button
              loading={sending || reach.state === 'loading'}
              disabled={!count || count.reachable === 0}
              onClick={send}
            >
              <Send strokeWidth={1.5} aria-hidden />
              {count ? countOf(language, count.reachable, b.sendConfirm) : b.send}
            </Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
