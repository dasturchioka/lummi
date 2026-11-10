'use client';

import { CONTENT_PLACEHOLDERS, infoPageInputSchema, type AdminInfoPage } from '@lummi/contracts';
import { ArrowLeft, Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { LangTabs } from './lang-tabs';
import {
  fillForPreview,
  placeholderValues,
  usedPlaceholders,
  type PlaceholderSettings,
} from './placeholders';
import { RichTextView } from './rich-text-view';

export function PageEditor({
  page,
  fills,
  t,
  language,
}: {
  page: AdminInfoPage;
  /** The settings behind the placeholders, so the preview reads as the customer's page. */
  fills: PlaceholderSettings;
  t: AdminMessages;
  language: 'ru' | 'uz';
}) {
  const c = t.content;
  const p = c.pages;
  const router = useRouter();
  const [lang, setLang] = useState<'ru' | 'uz'>(language);
  const [v, setV] = useState({
    titleRu: page.titleRu,
    titleUz: page.titleUz,
    bodyRu: page.bodyRu,
    bodyUz: page.bodyUz,
    draft: page.draft,
  });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'invalid'>('idle');
  const S = lang === 'ru' ? 'Ru' : 'Uz';
  const titleKey = `title${S}` as 'titleRu' | 'titleUz';
  const bodyKey = `body${S}` as 'bodyRu' | 'bodyUz';
  const values = placeholderValues(fills, lang);
  const used = usedPlaceholders(v[bodyKey]);

  const save = async () => {
    const parsed = infoPageInputSchema.safeParse(v);
    if (!parsed.success) return setState('invalid');
    setState('saving');
    const res = await browserApi.content.pages.update({
      params: { slug: page.slug },
      body: parsed.data,
    });
    if (res.status === 200) {
      setV({
        titleRu: res.body.titleRu,
        titleUz: res.body.titleUz,
        bodyRu: res.body.bodyRu,
        bodyUz: res.body.bodyUz,
        draft: res.body.draft,
      });
      setState('saved');
      router.refresh();
    } else setState(res.status === 422 ? 'invalid' : 'failed');
  };

  return (
    <>
      <Link
        href="/content"
        className="-ml-1 mb-3 inline-flex h-9 items-center gap-1.5 rounded-button px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
        {p.back}
      </Link>
      <PageHeader title={language === 'uz' ? page.titleUz : page.titleRu} description={p.hint} />
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Card className="grid gap-5 p-4 sm:p-6">
          <LangTabs
            value={lang}
            onChange={setLang}
            label={p.editing}
            labels={{ ru: c.langRu, uz: c.langUz }}
          />
          <div className="grid gap-5 lg:grid-cols-2 lg:items-start" lang={lang}>
            <div className="grid gap-4">
              <Field
                id="page-title"
                label={p.titleField}
                error={state === 'invalid' && !v[titleKey].trim() ? c.required : undefined}
              >
                <Input
                  value={v[titleKey]}
                  maxLength={80}
                  onChange={(e) => setV({ ...v, [titleKey]: e.target.value })}
                />
              </Field>
              <Field id="page-body" label={p.bodyField} hint={p.bodyHint}>
                <Textarea
                  className="min-h-56 max-h-[70vh] leading-[1.6]"
                  value={v[bodyKey]}
                  spellCheck
                  onChange={(e) => setV({ ...v, [bodyKey]: e.target.value })}
                />
              </Field>
              {/*
                What `{name}` turns into for the customer: the name to type, what it is, its value
                now, and whether this text uses it (the preview shows values plain, as the app does).
              */}
              <div className="grid gap-2">
                <p className="text-[12.5px] font-medium text-muted-foreground">{p.placeholders}</p>
                <dl className="grid gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
                  {CONTENT_PLACEHOLDERS.map((name) => (
                    <div key={name} className="contents">
                      <dt className="flex items-center gap-1.5">
                        <code
                          className={`rounded-[4px] px-1.5 py-0.5 font-mono text-[12.5px] select-all ${
                            used.has(name)
                              ? 'bg-sage-wash text-foreground'
                              : 'bg-field text-muted-foreground'
                          }`}
                        >
                          {`{${name}}`}
                        </code>
                      </dt>
                      <dd className="mb-1.5 text-pretty text-muted-foreground sm:mb-0">
                        {p.tokens[name]}
                        {values[name] ? (
                          <span className="text-foreground [overflow-wrap:anywhere]">
                            {' · '}
                            {values[name]}
                          </span>
                        ) : null}
                        {used.has(name) ? (
                          <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-xs font-medium whitespace-nowrap text-sage-ink">
                            <Check className="size-3.5" strokeWidth={1.5} aria-hidden />
                            {p.tokenUsed}
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <div className="grid gap-1.5" data-page-preview>
              <p className="text-[12.5px] font-medium text-muted-foreground">{p.preview}</p>
              {/*
                The Mini App's page on its Milk ground at a 390 px phone's width: 16 px gutters
                around the app's 358 px column, the Tenor caps title, then the text.
              */}
              <div className="w-full max-w-[390px] rounded-card bg-background px-4 pt-5 pb-5 shadow-[inset_0_0_0_1px_var(--hairline)]">
                <p className="title mb-4 [overflow-wrap:anywhere]">{v[titleKey]}</p>
                {v[bodyKey].trim() ? (
                  <RichTextView source={fillForPreview(v[bodyKey], values)} />
                ) : (
                  <p className="text-sm text-muted-foreground">{p.previewEmpty}</p>
                )}
              </div>
            </div>
          </div>
        </Card>
        <Card className="grid gap-4 p-4 sm:p-6">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={!v.draft}
              onChange={(e) => setV({ ...v, draft: !e.target.checked })}
              className="mt-0.5 size-5 shrink-0 accent-graphite"
            />
            <span className="grid gap-0.5">
              <span className="text-[15px] font-semibold">{p.approvedLabel}</span>
              <span className="text-sm text-pretty text-muted-foreground">{p.approvedHint}</span>
            </span>
          </label>
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
        </Card>
      </form>
    </>
  );
}
