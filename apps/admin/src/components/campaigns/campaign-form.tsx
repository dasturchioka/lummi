'use client';

import {
  CAMPAIGN_SOURCES,
  FRAGRANCE_START_PARAM,
  START_TARGETS,
  campaignLinkInputSchema,
  type AdminCampaignLink,
  type CampaignLinkInput,
  type CampaignSource,
} from '@lummi/contracts';
import { ArrowLeft, Check, CircleAlert, Copy, Download } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { CodeText } from '@/components/promo/code-text';
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
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';

const FRAGRANCE = 'fragrance';

interface Draft {
  code: string;
  /** A start target, or `fragrance` with `slug` picked. */
  kind: string;
  slug: string;
  promoCode: string;
  source: CampaignSource;
  sourceLabel: string;
}

function toDraft(l: AdminCampaignLink | null): Draft {
  const slug = l ? FRAGRANCE_START_PARAM.exec(l.target)?.[1] : undefined;
  return {
    code: l?.code ?? '',
    kind: slug ? FRAGRANCE : (l?.target ?? 'catalog'),
    slug: slug ?? '',
    promoCode: l?.promoCode ?? '',
    source: l?.source ?? 'instagram',
    sourceLabel: l?.sourceLabel ?? '',
  };
}

function toInput(d: Draft): CampaignLinkInput {
  return {
    ...(d.code.trim() === '' ? {} : { code: d.code.trim() }),
    target: d.kind === FRAGRANCE ? (d.slug ? `p_${d.slug}` : '') : d.kind,
    promoCode: d.promoCode === '' ? null : d.promoCode,
    source: d.source,
    sourceLabel: d.sourceLabel.trim() === '' ? null : d.sourceLabel.trim(),
  };
}

/**
 * Create and edit a campaign link: where it opens (a screen or a fragrance by name), the promo
 * code it prefills, the source, and for a saved link its QR. The code is fixed once anyone opened
 * the link, because it is printed and posted by then.
 */
export function CampaignForm({
  initial,
  promoCodes,
  fragrances,
  t,
}: {
  initial: AdminCampaignLink | null;
  promoCodes: string[];
  fragrances: { slug: string; name: string; brand: string }[];
  t: AdminMessages;
}) {
  const m = t.campaigns;
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [copied, setCopied] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors(({ [k]: _gone, ...rest }) => rest);
  };
  const locked = saved?.everOpened ?? false;

  const save = async () => {
    setBanner(null);
    const parsed = campaignLinkInputSchema.safeParse(toInput(draft));
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        const key = field === 'target' ? (draft.kind === FRAGRANCE ? 'slug' : 'kind') : field;
        found[key] ??=
          issue.message === 'required' || key === 'slug'
            ? m.required
            : field === 'code'
              ? m.codeFormat
              : m.required;
      }
      setErrors(found);
      setBanner({ kind: 'error', text: m.fixErrors });
      return;
    }
    setErrors({});
    setPending(true);
    const res = await (
      saved
        ? browserApi.campaignLinks.update({ params: { id: saved.id }, body: parsed.data })
        : browserApi.campaignLinks.create({ body: parsed.data })
    ).catch(() => null);
    setPending(false);
    if (res && (res.status === 200 || res.status === 201)) {
      const next = res.body as AdminCampaignLink;
      if (!saved) {
        router.push(`/campaign-links/${next.id}`);
        return;
      }
      setSaved(next);
      setDraft(toDraft(next));
      setBanner({ kind: 'ok', text: m.saved });
      router.refresh();
      return;
    }
    const code = (res?.body as { code?: string } | undefined)?.code;
    if (res?.status === 409 && code === 'code_taken') {
      setErrors({ code: m.codeTaken });
      setBanner({ kind: 'error', text: m.codeTaken });
    } else if (res?.status === 409 && code === 'code_locked') {
      setSaved({ ...(saved as AdminCampaignLink), everOpened: true });
      setBanner({ kind: 'error', text: m.codeLocked });
    } else if (res?.status === 422 && code === 'unknown_promo_code') {
      setErrors({ promoCode: m.promoUnknown });
      setBanner({ kind: 'error', text: m.promoUnknown });
    } else setBanner({ kind: 'error', text: m.failed });
  };

  const remove = async () => {
    if (!saved) return;
    const res = await browserApi.campaignLinks
      .remove({ params: { id: saved.id } })
      .catch(() => null);
    setRemoving(false);
    if (res?.status === 200) {
      router.push('/campaign-links');
      router.refresh();
      return;
    }
    if (res?.status === 409) {
      setSaved({ ...saved, everOpened: true });
      setBanner({ kind: 'error', text: m.inUse });
    } else setBanner({ kind: 'error', text: m.failed });
  };

  const copy = async () => {
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(saved.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link is selectable on the page */
    }
  };

  const needsLabel = draft.source === 'other' || draft.source === 'blogger';
  const qr = saved ? `/api/admin/campaign-links/${saved.id}/qr` : null;
  const targetLabels = t.broadcasts.targets as Record<string, string>;
  return (
    <form
      noValidate
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="[&_:is(input,select)]:scroll-mt-24 [&_:is(input,select)]:scroll-mb-28"
    >
      <PageHeader
        title={saved ? <CodeText code={saved.code} /> : m.newTitle}
        description={
          saved ? `${m.opens}: ${saved.opens} · ${m.orders}: ${saved.orders}` : undefined
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/campaign-links">
              <ArrowLeft strokeWidth={1.5} aria-hidden />
              {m.back}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4">
        <Section title={m.sectionDestination}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="c-target" className="content-start" label={m.target} error={errors.kind}>
              <Select value={draft.kind} onChange={(e) => set('kind', e.target.value)}>
                {START_TARGETS.map((k) => (
                  <option key={k} value={k}>
                    {targetLabels[k]}
                  </option>
                ))}
                <option value={FRAGRANCE}>{m.fragrance}</option>
              </Select>
            </Field>
            {draft.kind === FRAGRANCE && (
              <Field
                id="c-slug"
                className="content-start"
                label={m.fragrance}
                hint={m.fragranceHint}
                error={errors.slug}
              >
                <Select value={draft.slug} onChange={(e) => set('slug', e.target.value)}>
                  <option value="">{m.fragrancePick}</option>
                  {fragrances.map((f) => (
                    <option key={f.slug} value={f.slug}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field
              id="c-promo"
              className="content-start"
              label={m.promoCode}
              hint={m.promoHint}
              error={errors.promoCode}
            >
              <Select value={draft.promoCode} onChange={(e) => set('promoCode', e.target.value)}>
                <option value="">{m.promoNone}</option>
                {promoCodes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section title={m.sectionSource}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="c-source" className="content-start" label={m.source}>
              <Select
                value={draft.source}
                onChange={(e) => set('source', e.target.value as CampaignSource)}
              >
                {CAMPAIGN_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {m.sources[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="c-label"
              className="content-start"
              label={m.sourceLabel}
              hint={m.sourceLabelHint}
              error={errors.sourceLabel}
            >
              <Input
                value={draft.sourceLabel}
                maxLength={60}
                aria-required={needsLabel}
                onChange={(e) => set('sourceLabel', e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title={m.sectionLink}>
          <Field
            id="c-code"
            className="content-start md:max-w-md"
            label={m.code}
            hint={locked ? m.codeLocked : m.codeHint}
            error={errors.code}
          >
            <Input
              value={draft.code}
              maxLength={40}
              disabled={locked}
              autoCapitalize="none"
              spellCheck={false}
              className="font-semibold tracking-[0.04em]"
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
        </Section>

        <Section title={m.sectionQr}>
          {saved && qr ? (
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
              {/* the server draws it; an <img> shows it, the download links save it */}
              <img
                src={qr}
                alt={m.sectionQr}
                width={168}
                height={168}
                className="size-[168px] rounded-card border border-border bg-white"
              />
              <div className="grid min-w-0 content-start gap-3">
                <p className="text-small text-muted-foreground">{m.link}</p>
                <p className="text-sm font-medium [overflow-wrap:anywhere] select-all">
                  {saved.url}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void copy()}>
                    {copied ? (
                      <Check strokeWidth={1.5} aria-hidden />
                    ) : (
                      <Copy strokeWidth={1.5} aria-hidden />
                    )}
                    {copied ? m.copied : m.copy}
                  </Button>
                  <Button variant="outline" asChild>
                    <a href={`${qr}?format=png`} download>
                      <Download strokeWidth={1.5} aria-hidden />
                      {m.downloadPng}
                    </a>
                  </Button>
                  <Button variant="outline" asChild>
                    <a href={`${qr}?format=svg`} download>
                      <Download strokeWidth={1.5} aria-hidden />
                      {m.downloadSvg}
                    </a>
                  </Button>
                </div>
                <p className="text-small text-pretty text-muted-foreground">{m.qrHint}</p>
              </div>
            </div>
          ) : (
            <p className="text-small text-muted-foreground">{m.saveFirst}</p>
          )}
          {saved && locked && (
            <p className="text-small text-pretty text-muted-foreground">{m.usedNote}</p>
          )}
        </Section>

        {saved && !locked && (
          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={() => setRemoving(true)}>
              {m.remove}
            </Button>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <Button type="submit" loading={pending} className="max-sm:w-full sm:min-w-40">
          {m.save}
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

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogTitle>{m.removeTitle}</AlertDialogTitle>
          <AlertDialogDescription>{m.removeText}</AlertDialogDescription>
          <DialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">{m.cancel}</Button>
            </AlertDialogCancel>
            <Button onClick={() => void remove()}>{m.remove}</Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
