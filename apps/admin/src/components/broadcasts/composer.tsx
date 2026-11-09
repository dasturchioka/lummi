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
  type BroadcastBody,
} from '@lummi/contracts';
import { plural, type Language } from '@lummi/i18n';
import { Check, CircleAlert, ImageOff, ImagePlus, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm, type FieldError, type Resolver } from 'react-hook-form';
import { PageHeader } from '@/components/page-header';
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
import { TEXT_LINK } from '@/lib/ui-classes';
import { fill } from '@/lib/utils';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type Count = { total: number; reachable: number };
type Status = { kind: 'ok' | 'error'; text: string } | null;

/**
 * The owner's composer: RU and UZ text, an optional image and link button, the audience with a
 * live recipient count, «Отправить себе» and «Отправить» (behind a confirmation that names the
 * audience). The server checks everything again; here the checks only save a round trip.
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

  // live recipient count for the chosen audience
  const [count, setCount] = useState<Count | null>(initialCount);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let live = true;
    setCount(null);
    void browserApi.broadcasts.audience({ query: { audience: v.audience } }).then((res) => {
      if (live && res.status === 200) setCount(res.body);
    });
    return () => {
      live = false;
    };
  }, [v.audience]);

  // image: uploaded when picked; the key is what the form sends
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageState, setImageState] = useState<Status | { kind: 'busy'; text: string }>(null);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type))
      return setImageState({ kind: 'error', text: b.imageBadType });
    if (file.size > MAX_PHOTO_BYTES) return setImageState({ kind: 'error', text: b.imageTooBig });
    setImageState({ kind: 'busy', text: b.imageUploading });
    const res = await fetch('/api/admin/broadcasts/image', {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    }).catch(() => null);
    if (res?.ok) {
      const { key } = (await res.json()) as { key: string };
      setPreview(URL.createObjectURL(file));
      setValue('imageKey', key, { shouldDirty: true });
      setImageState(null);
      void trigger(['textRu', 'textUz']);
    } else {
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
    setPreview(null);
    setImageState(null);
    setValue('imageKey', null, { shouldDirty: true });
    void trigger(['textRu', 'textUz']);
  };

  // soft copy rules: a hint under the text, never a block
  const warnings = [...new Set([...copyWarnings(v.textRu), ...copyWarnings(v.textUz)])];

  const limit = v.imageKey ? CAPTION_MAX : TEXT_MAX;
  const counter = (text: string) => fill(b.counter, { n: String(text.length), max: String(limit) });

  // «Отправить себе»
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<Status>(null);
  const sendTest = async () => {
    setTestStatus(null);
    if (!(await trigger()) || slugBad) return;
    setTesting(true);
    const res = await browserApi.broadcasts.test({ body: getValues() }).catch(() => null);
    setTesting(false);
    if (res?.status === 200) setTestStatus({ kind: 'ok', text: b.testSent });
    else if (res?.status === 502 && res.body.code === 'test_blocked')
      setTestStatus({ kind: 'error', text: b.testBlocked });
    else setTestStatus({ kind: 'error', text: b.testFailed });
  };

  // «Отправить»: validate, confirm with the audience size, send
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const review = handleSubmit(
    () => {
      if (slugBad) return;
      setSendError(null);
      setConfirming(true);
    },
    () => setSendError(b.fixErrors),
  );
  const send = async () => {
    setSending(true);
    setSendError(null);
    const res = await browserApi.broadcasts.create({ body: getValues() }).catch(() => null);
    setSending(false);
    if (res?.status === 201) return router.push(`/broadcasts/${res.body.id}`);
    setConfirming(false);
    if (res?.status === 422) {
      for (const f of res.body.fields ?? []) {
        if (f === 'imageKey') setError('imageKey', { message: b.errors.imageMissing });
        if (f === 'buttonTarget') setError('buttonTarget', { message: b.errors.slugUnknown });
      }
      setSendError(b.fixErrors);
    } else setSendError(b.sendFailed);
  };

  const addressees = count ? plural(language, count.reachable, b.addressees) : null;
  const blockedCount = count ? count.total - count.reachable : 0;
  const shownImage = preview;

  return (
    <>
      <PageHeader
        title={b.newTitle}
        description={b.newDescription}
        actions={
          <Link href="/broadcasts" className={TEXT_LINK}>
            {b.back}
          </Link>
        }
      />
      <form onSubmit={review} noValidate className="grid max-w-[46rem] gap-4">
        <Card className="grid gap-5 px-4 py-5 @container sm:px-6">
          <Field id="bc-ru" label={b.textRu} hint={b.textHint} error={message(errors.textRu)}>
            <Textarea lang="ru" rows={5} {...register('textRu')} />
          </Field>
          <p className="-mt-3 text-right text-xs text-muted-foreground tabular-nums">
            {counter(v.textRu)}
          </p>
          <Field id="bc-uz" label={b.textUz} error={message(errors.textUz)}>
            <Textarea lang="uz" rows={5} {...register('textUz')} />
          </Field>
          <p className="-mt-3 text-right text-xs text-muted-foreground tabular-nums">
            {counter(v.textUz)}
          </p>
          {warnings.length > 0 && (
            <Notice title={b.warnings.title}>{warnings.map((w) => b.warnings[w]).join(' ')}</Notice>
          )}
        </Card>

        <Card className="grid gap-5 px-4 py-5 sm:px-6">
          <div className="grid gap-1.5" data-image>
            <p className="text-[12.5px] font-medium text-muted-foreground">{b.image}</p>
            <div className="flex flex-col gap-3 @xs:flex-row sm:flex-row sm:items-start sm:gap-4">
              <div className="grid aspect-[3/4] w-24 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-field">
                {shownImage ? (
                  <img src={shownImage} alt="" className="size-full object-cover" />
                ) : (
                  <ImageOff
                    className="size-5 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
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
                    loading={imageState?.kind === 'busy'}
                    onClick={() => input.current?.click()}
                  >
                    <ImagePlus strokeWidth={1.5} aria-hidden />
                    {v.imageKey ? b.imageReplace : b.imageChoose}
                  </Button>
                  {v.imageKey && (
                    <Button type="button" variant="ghost" size="sm" onClick={removeImage}>
                      <Trash2 strokeWidth={1.5} aria-hidden />
                      {b.imageRemove}
                    </Button>
                  )}
                </div>
                <p className="text-xs leading-snug text-pretty text-muted-foreground">
                  {b.imageHint}
                </p>
                {imageState && imageState.kind === 'error' && (
                  <p
                    role="alert"
                    className="flex items-start gap-1.5 text-xs leading-snug font-medium"
                  >
                    <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                    {imageState.text}
                  </p>
                )}
                {errors.imageKey && (
                  <p role="alert" className="text-xs leading-snug font-medium">
                    {errors.imageKey.message}
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
              <Field
                id="bc-slug"
                label={b.fragranceSlug}
                hint={b.fragranceSlugHint}
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
                  onChange={(e) => pickTarget('fragrance', e.target.value.trim().toLowerCase())}
                />
              </Field>
            )}
          </div>
        </Card>

        <Card className="grid gap-4 px-4 py-5 sm:px-6">
          <Field id="bc-audience" label={b.audience}>
            <Select {...register('audience')}>
              {BROADCAST_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {b.audiences[a]}
                </option>
              ))}
            </Select>
          </Field>
          <div role="status" aria-live="polite" className="text-sm" data-audience-size>
            {count === null ? (
              <span className="text-muted-foreground">{b.countLoading}</span>
            ) : (
              <>
                <p className="font-semibold">{addressees}</p>
                {blockedCount > 0 && (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {fill(b.addresseesBlocked, { n: String(blockedCount) })}
                  </p>
                )}
              </>
            )}
          </div>
        </Card>

        {sendError && <Notice title={sendError} />}
        {testStatus && (
          <p
            role={testStatus.kind === 'error' ? 'alert' : 'status'}
            className="flex items-start gap-2 rounded-button bg-field px-4 py-3 text-sm font-medium"
            data-test-status
          >
            {testStatus.kind === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
            ) : (
              <Check
                className="mt-0.5 size-4 shrink-0 text-sage-ink"
                strokeWidth={1.5}
                aria-hidden
              />
            )}
            {testStatus.text}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" loading={testing} onClick={sendTest}>
            {b.sendTest}
          </Button>
          <Button type="submit" disabled={count?.reachable === 0}>
            <Send strokeWidth={1.5} aria-hidden />
            {b.send}
          </Button>
        </div>
      </form>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>{b.sendTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {fill(b.sendText, { addressees: addressees ?? '' })}
          </AlertDialogDescription>
          <DialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">{t.actions.cancel}</Button>
            </AlertDialogCancel>
            <Button loading={sending} onClick={send}>
              {b.sendConfirm}
            </Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
