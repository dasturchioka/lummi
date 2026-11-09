'use client';

import type { Draft, InputSpec, Localized, SettingIssue } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { AdminMessages } from '@/lib/i18n';
import { issueMessage, pick } from '@/lib/setting-copy';
import { cn } from '@/lib/utils';

export interface EditorMeta {
  settingKey: string;
  /** Accessible name of the whole setting's control. */
  ariaLabel: string;
  language: Language;
  t: AdminMessages;
  unit?: string;
  fields?: Record<string, Localized>;
  optionLabels?: Record<string, Localized>;
  issues: SettingIssue[];
}

const pathKey = (p: string[]) => p.join('.');

function Issues({ meta, path, prefix }: { meta: EditorMeta; path: string[]; prefix?: boolean }) {
  const here = meta.issues.filter((i) =>
    prefix ? pathKey(i.path).startsWith(pathKey(path)) : pathKey(i.path) === pathKey(path),
  );
  if (here.length === 0) return null;
  return (
    <ul className="mt-1.5 grid gap-0.5" id={`${meta.settingKey}__${pathKey(path)}-error`}>
      {here.map((i, n) => (
        <li key={n} className="text-[13px] font-medium text-foreground">
          {issueMessage(meta.t, i)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Renders any InputSpec: the page never knows which setting it is editing. Leaves are inputs
 * (with the unit beside them), a group is a fieldset of labelled parts.
 */
export function SettingEditor({
  spec,
  draft,
  onChange,
  meta,
  path = [],
  label,
}: {
  spec: InputSpec;
  draft: Draft;
  onChange: (next: Draft) => void;
  meta: EditorMeta;
  path?: string[];
  /** A boolean's own caption (its group field name); otherwise Yes / No. */
  label?: string;
}) {
  const id = `${meta.settingKey}__${pathKey(path)}`;
  const invalid = meta.issues.some((i) => pathKey(i.path) === pathKey(path));
  const describedBy = invalid ? `${id}-error` : undefined;
  // a top-level control is named by the setting; group parts have their own visible labels
  const aria = path.length === 0 ? { 'aria-label': meta.ariaLabel } : {};
  const unit = meta.unit ? (
    <span className="shrink-0 text-[13px] text-muted-foreground">{meta.unit}</span>
  ) : null;

  switch (spec.kind) {
    case 'group':
      return (
        <div className={cn('grid gap-3', path.length > 0 && 'border-l-2 border-stone pl-3')}>
          {spec.fields.map((f) => {
            const p = [...path, f.name];
            const label = meta.fields?.[pathKey(p)]
              ? pick(meta.fields[pathKey(p)] as Localized, meta.language)
              : f.name;
            const child = (draft as Record<string, Draft>)[f.name] ?? '';
            return f.spec.kind === 'boolean' ? (
              <SettingEditor
                key={f.name}
                spec={f.spec}
                draft={child}
                meta={meta}
                path={p}
                label={label}
                onChange={(v) => onChange({ ...(draft as Record<string, Draft>), [f.name]: v })}
              />
            ) : (
              <div key={f.name} className="grid gap-1.5">
                <label
                  htmlFor={`${meta.settingKey}__${pathKey(p)}`}
                  className="text-[12.5px] font-medium text-muted-foreground"
                >
                  {label}
                </label>
                <SettingEditor
                  spec={f.spec}
                  draft={child}
                  meta={meta}
                  path={p}
                  onChange={(v) => onChange({ ...(draft as Record<string, Draft>), [f.name]: v })}
                />
              </div>
            );
          })}
        </div>
      );
    case 'boolean':
      return (
        <div>
          <label className="flex min-h-11 items-center gap-3 text-[15px]">
            <input
              id={id}
              {...aria}
              type="checkbox"
              className="size-5 shrink-0 accent-graphite"
              checked={draft === true}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span>{label ?? (draft === true ? meta.t.settings.on : meta.t.settings.off)}</span>
          </label>
        </div>
      );
    case 'enum':
      return (
        <div>
          <Select
            id={id}
            {...aria}
            value={String(draft)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          >
            {spec.options.map((o) => (
              <option key={o} value={o}>
                {meta.optionLabels?.[o]
                  ? pick(meta.optionLabels[o] as Localized, meta.language)
                  : o}
              </option>
            ))}
          </Select>
          <Issues meta={meta} path={path} />
        </div>
      );
    case 'json':
      return (
        <div>
          <textarea
            id={id}
            {...aria}
            rows={5}
            spellCheck={false}
            className="w-full rounded-button bg-field px-3.5 py-2.5 font-mono text-[13px] shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
            value={String(draft)}
            onChange={(e) => onChange(e.target.value)}
          />
          <Issues meta={meta} path={path} prefix />
        </div>
      );
    case 'list':
      return (
        <div>
          <div className="flex items-center gap-2">
            <Input
              id={id}
              {...aria}
              autoComplete="off"
              inputMode={spec.item.kind === 'text' ? 'text' : 'numeric'}
              aria-invalid={
                meta.issues.some((i) => pathKey(i.path).startsWith(pathKey(path))) || undefined
              }
              aria-describedby={describedBy}
              value={String(draft)}
              onChange={(e) => onChange(e.target.value)}
            />
            {unit}
          </div>
          <Issues meta={meta} path={path} prefix />
        </div>
      );
    default: {
      // integer, number, text and nullable of those
      const numeric = (spec.kind === 'nullable' ? spec.inner.kind : spec.kind) !== 'text';
      return (
        <div>
          <div className="flex items-center gap-2">
            <Input
              id={id}
              {...aria}
              autoComplete="off"
              inputMode={numeric ? 'decimal' : 'text'}
              placeholder={spec.kind === 'nullable' ? meta.t.settings.notSet : undefined}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              value={String(draft)}
              onChange={(e) => onChange(e.target.value)}
            />
            {unit}
          </div>
          <Issues meta={meta} path={path} />
        </div>
      );
    }
  }
}
