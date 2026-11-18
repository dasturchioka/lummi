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
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { SettingEditor } from '@/components/setting-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import {
  displayValue,
  formatTashkent,
  groupParts,
  pick,
  rangeText,
  unitText,
} from '@/lib/setting-copy';
import { describeInput, fromDraft, toDraft, type Draft } from '@/lib/setting-input';
import { QUIET_ACTION } from '@/lib/ui-classes';
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
  const areas = SETTING_AREAS.map((area) => ({
    area,
    keys: settingKeys.filter((k) => settingMeta(k).area === area),
  })).filter((a) => a.keys.length > 0);
  return (
    <>
      <PageHeader title={t.settings.title} description={t.settings.description} />
      {/* a long page: the areas as chips that jump to their card (one scrolling row on phones) */}
      <nav
        aria-label={t.settings.sections}
        className="-mx-4 mb-6 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {areas.map(({ area }) => (
            <li key={area}>
              <a
                href={`#area-${area}`}
                className="inline-flex h-[34px] items-center rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-[background-color,transform] duration-150 ease-out select-none [-webkit-touch-callout:none] hover:bg-field active:scale-[0.97] active:bg-field"
              >
                {t.settings.areas[area]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid gap-6">
        {areas.map(({ area, keys }) => (
          <section key={area} aria-labelledby={`area-${area}`}>
            <Card>
              {/* DESIGN.md "Section" role, as the fragrance form heads its cards */}
              <div className="px-4 pt-5 lg:px-5">
                <h2
                  id={`area-${area}`}
                  className="scroll-mt-24 font-display lg:scroll-mt-10 text-[13px] leading-[1.35] tracking-[0.2em] uppercase"
                >
                  {t.settings.areas[area]}
                </h2>
                {area in t.settings.areaHints && (
                  <Notice
                    title={t.settings.areaHints[area as keyof typeof t.settings.areaHints]}
                    className="mt-3"
                  />
                )}
              </div>
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
        ))}
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
  const range = def.hideBounds ? null : rangeText(t, spec, settingKey, language);
  const label = pick(def.label, language);
  const hint = def.hint ? pick(def.hint, language) : null;
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

  // one line for where the value stands: just saved, edited and not saved yet, or last change
  const status =
    justSaved && !dirty ? (
      <Badge tone="sage" className="animate-[overlay-in_200ms_var(--ease-out)]">
        {t.settings.saved}
      </Badge>
    ) : dirty && !pending ? (
      <span className="font-medium text-foreground">{t.settings.unsaved}</span>
    ) : saved.updatedAt ? (
      fill(t.settings.changedAt, { date: formatTashkent(saved.updatedAt) })
    ) : (
      t.settings.neverChanged
    );

  return (
    <li className="grid gap-4 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-10 lg:px-5">
      <div className="min-w-0">
        <h3 className="text-[15px] leading-snug font-semibold text-balance break-words">{label}</h3>
        {hint && (
          <p className="mt-1 max-w-[60ch] text-[13px] leading-normal text-pretty break-words text-muted-foreground">
            {hint}
          </p>
        )}
        <div className="mt-2.5 grid gap-0.5 text-small text-muted-foreground">
          <MetaLine parts={[t.settings.types[spec.kind], range]} />
          {spec.kind === 'group' ? (
            // several values: one per line, as the fields stand on the right
            <div>
              <p>{t.settings.defaultValue}:</p>
              <ul className="text-foreground">
                {groupParts(settingKey, spec, def.default, language, t).map((part) => (
                  <li key={part} className="break-words">
                    {part}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="break-words">
              {t.settings.defaultValue}:{' '}
              <span className="text-foreground">
                {displayValue(settingKey, spec, def.default, language, t)}
              </span>
            </p>
          )}
          <p className="break-words">
            {t.settings.key}: <code className="font-mono text-[12px]">{settingKey}</code>
          </p>
        </div>
      </div>

      <form
        className="min-w-0"
        noValidate
        aria-busy={pending || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !pending) void save();
        }}
      >
        {def.picker === 'fragrance' ? (
          <FragrancePicker draft={draft} onChange={change} label={label} t={t} />
        ) : (
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
              ...(def.unit ? { unitKind: def.unit } : {}),
              ...(def.fields ? { fields: def.fields } : {}),
              ...(def.optionLabels ? { optionLabels: def.optionLabels } : {}),
              issues,
            }}
          />
        )}
        {saved.invalid && !dirty && <Notice title={t.settings.invalidStored} className="mt-3" />}
        {failure && <Notice title={failure} className="mt-3" />}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!dirty} loading={pending}>
            {t.settings.save}
          </Button>
          {/* only where it would change something; it hands focus to the field it filled */}
          {canReset && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={QUIET_ACTION}
              disabled={pending}
              onClick={(e) => {
                change(defaultDraft);
                e.currentTarget.form
                  ?.querySelector<HTMLElement>('input, select, textarea')
                  ?.focus({ preventScroll: true });
              }}
            >
              {t.settings.reset}
            </Button>
          )}
        </div>
        <p aria-live="polite" className="mt-2 text-small text-muted-foreground">
          {status}
        </p>
      </form>
    </li>
  );
}

/**
 * A setting whose value is a fragrance (`picker: 'fragrance'`, the gift sample's, #79): a select of
 * the catalog by name, 0 first under its own label. A stored fragrance that is gone from the
 * catalog or hidden stays selected and says so, so a sample never stops without a word.
 */
function FragrancePicker({
  draft,
  onChange,
  label,
  t,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  label: string;
  t: AdminMessages;
}) {
  const p = t.settings.fragrancePicker;
  const [options, setOptions] = useState<{ id: number; name: string; hidden: boolean }[] | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    browserApi.catalog.fragrances
      .list({ query: {} })
      .then((res) => {
        if (live && res.status === 200)
          setOptions(res.body.map((f) => ({ id: f.id, name: f.name, hidden: f.hidden })));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const value = typeof draft === 'string' && draft.trim() !== '' ? draft.trim() : '0';
  const chosen =
    value === '0' || options === null ? null : options.find((o) => String(o.id) === value);
  const warning = chosen === undefined ? p.missing : chosen?.hidden ? p.hidden : null;
  return (
    <div className="grid gap-3">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="0">{p.zero}</option>
        {/* the stored one stays selectable while the list loads, or once it is gone */}
        {value !== '0' && (options === null || chosen === undefined) && (
          <option value={value}>{options === null ? p.loading : p.missing}</option>
        )}
        {options?.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.hidden ? `${o.name} (${p.hiddenTag})` : o.name}
          </option>
        ))}
      </Select>
      {warning && <Notice title={warning} />}
    </div>
  );
}
