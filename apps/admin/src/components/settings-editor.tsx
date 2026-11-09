'use client';

import {
  SETTING_AREAS,
  settingKeys,
  settingMeta,
  type SettingIssue,
  type SettingKey,
  type SettingState,
  toSettingIssues,
} from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { SettingEditor } from '@/components/setting-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { displayValue, formatTashkent, pick, rangeText, unitText } from '@/lib/setting-copy';
import { describeInput, fromDraft, toDraft, type Draft } from '@/lib/setting-input';
import { fill } from '@/lib/utils';

/**
 * The owner's settings page, generated from the registry in `@lummi/contracts`: every key, its
 * labels, unit, default and bounds come from there, so a setting registered later shows up here
 * with no change to this file. The server validates again; this check only saves a round trip.
 */
export function SettingsEditor({
  states,
  language,
  t,
}: {
  states: SettingState[];
  language: Language;
  t: AdminMessages;
}) {
  const byKey = useMemo(() => new Map(states.map((s) => [s.key, s])), [states]);
  return (
    <>
      <PageHeader title={t.settings.title} description={t.settings.description} />
      <div className="grid gap-8">
        {SETTING_AREAS.map((area) => {
          const keys = settingKeys.filter((k) => settingMeta(k).area === area);
          if (keys.length === 0) return null;
          return (
            <section key={area} aria-labelledby={`area-${area}`}>
              <h2 id={`area-${area}`} className="text-[15px] font-semibold">
                {t.settings.areas[area]}
              </h2>
              {area in t.settings.areaHints && (
                <div className="mt-2">
                  <Notice title={t.settings.areaHints[area as keyof typeof t.settings.areaHints]} />
                </div>
              )}
              <div className="mb-3" />
              <Card>
                <ul className="divide-y divide-border">
                  {keys.map((key) => (
                    <SettingRow
                      key={key}
                      settingKey={key}
                      initial={byKey.get(key)}
                      language={language}
                      t={t}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          );
        })}
      </div>
    </>
  );
}

function SettingRow({
  settingKey,
  initial,
  language,
  t,
}: {
  settingKey: SettingKey;
  initial: SettingState | undefined;
  language: Language;
  t: AdminMessages;
}) {
  const def = settingMeta(settingKey);
  const meta = def;
  const spec = useMemo(() => describeInput(def.schema), [def.schema]);
  const defaultDraft = useMemo(() => toDraft(spec, def.default), [spec, def.default]);
  const [saved, setSaved] = useState<{
    value: unknown;
    updatedAt: string | null;
    invalid: boolean;
  }>({
    value: initial?.value ?? def.default,
    updatedAt: initial?.updatedAt ?? null,
    invalid: initial?.invalid ?? false,
  });
  const savedDraft = useMemo(() => toDraft(spec, saved.value), [spec, saved.value]);
  const [draft, setDraft] = useState<Draft>(savedDraft);
  const [issues, setIssues] = useState<SettingIssue[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
  const dirty = !same(draft, savedDraft);
  const canReset = !same(draft, defaultDraft);
  const range = rangeText(t, spec);
  const label = pick(def.label, language);
  const hint = meta.hint ? pick(meta.hint, language) : null;
  const unit = unitText(settingKey, t) ?? undefined;

  const change = (next: Draft) => {
    setDraft(next);
    setIssues([]);
    setFailure(null);
    setJustSaved(false);
  };

  const save = async () => {
    setFailure(null);
    const value = fromDraft(spec, draft);
    const checked = def.schema.safeParse(value);
    if (!checked.success) return setIssues(toSettingIssues(checked.error));
    setPending(true);
    const res = await browserApi.settings
      .update({ params: { key: settingKey }, body: { value: checked.data } })
      .catch(() => null);
    setPending(false);
    if (res?.status === 200) {
      setSaved({ value: res.body.value, updatedAt: res.body.updatedAt, invalid: false });
      setDraft(toDraft(spec, res.body.value));
      setIssues([]);
      setJustSaved(true);
    } else if (res?.status === 400) {
      setIssues(res.body.issues);
    } else {
      setFailure(res?.status === 403 ? t.errors.forbidden : t.errors.generic);
    }
  };

  const meaning = [`${t.settings.type}: ${t.settings.types[spec.kind]}`, range].filter(Boolean);

  return (
    <li className="grid gap-4 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-8 lg:px-5">
      <div className="min-w-0">
        <h3 className="font-semibold text-balance [overflow-wrap:anywhere]">{label}</h3>
        {hint && <p className="mt-1 text-sm text-pretty text-muted-foreground">{hint}</p>}
        <dl className="mt-3 grid gap-1 text-[13px] text-muted-foreground">
          <div className="flex flex-wrap gap-x-1.5">
            <dt>{t.settings.key}:</dt>
            <dd className="font-mono text-[12.5px] [overflow-wrap:anywhere]">{settingKey}</dd>
          </div>
          <div className="flex flex-wrap gap-x-1.5">
            <dt>{meaning[0]}</dt>
            {meaning[1] && <dd>· {meaning[1]}</dd>}
          </div>
          <div className="flex flex-wrap gap-x-1.5">
            <dt>{t.settings.defaultValue}:</dt>
            <dd className="text-foreground [overflow-wrap:anywhere]">
              {displayValue(settingKey, spec, def.default, language, t)}
            </dd>
          </div>
        </dl>
      </div>

      <form
        className="min-w-0"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !pending) void save();
        }}
      >
        <SettingEditor
          spec={spec}
          draft={draft}
          onChange={change}
          meta={{
            settingKey,
            ariaLabel: label,
            language,
            t,
            ...(unit ? { unit } : {}),
            ...(meta.fields ? { fields: meta.fields } : {}),
            ...(meta.optionLabels ? { optionLabels: meta.optionLabels } : {}),
            issues,
          }}
        />
        {saved.invalid && !dirty && <Notice title={t.settings.invalidStored} className="mt-3" />}
        {failure && <Notice title={failure} className="mt-3" />}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!dirty} loading={pending}>
            {t.settings.save}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!canReset || pending}
            onClick={() => change(defaultDraft)}
          >
            {t.settings.reset}
          </Button>
          {justSaved && !dirty ? (
            <Badge tone="sage">{t.settings.saved}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">
              {saved.updatedAt
                ? fill(t.settings.changedAt, { date: formatTashkent(saved.updatedAt) })
                : t.settings.neverChanged}
            </span>
          )}
        </div>
      </form>
    </li>
  );
}
