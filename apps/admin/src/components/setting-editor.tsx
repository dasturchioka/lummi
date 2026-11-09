'use client';

import type { Bilingual, SettingIssue, SettingUnit } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { CircleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { AdminMessages } from '@/lib/i18n';
import { fromDraft, type Draft, type InputSpec } from '@/lib/setting-input';
import { durationText, issueMessage, pick } from '@/lib/setting-copy';
import { cn } from '@/lib/utils';

export interface EditorMeta {
  settingKey: string;
  /** Accessible name of the whole setting's control. */
  ariaLabel: string;
  language: Language;
  t: AdminMessages;
  unit?: string;
  /**
   * What the number measures: so'm is read back grouped under the field («100 000 000 сум»),
   * seconds and milliseconds as a duration («= 7 дней»).
   */
  unitKind?: SettingUnit;
  fields?: Record<string, Bilingual>;
  optionLabels?: Record<string, Bilingual>;
  issues: SettingIssue[];
}

const pathKey = (p: string[]) => p.join('.');

const isNumber = (spec: InputSpec): boolean =>
  spec.kind === 'integer' ||
  spec.kind === 'number' ||
  (spec.kind === 'nullable' && isNumber(spec.inner));

function Issues({ meta, path, prefix }: { meta: EditorMeta; path: string[]; prefix?: boolean }) {
  const here = meta.issues.filter((i) =>
    prefix ? pathKey(i.path).startsWith(pathKey(path)) : pathKey(i.path) === pathKey(path),
  );
  if (here.length === 0) return null;
  // the message names the fix; the icon and the field's Graphite outline mark it (no red)
  return (
    <ul className="mt-1.5 grid gap-0.5" id={`${meta.settingKey}__${pathKey(path)}-error`}>
      {here.map((i, n) => (
        <li
          key={n}
          className="flex animate-[overlay-in_150ms_var(--ease-out)] items-start gap-1.5 text-[13px] leading-snug font-medium text-foreground"
        >
          <CircleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
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
    <span className="shrink-0 text-small whitespace-nowrap text-muted-foreground">{meta.unit}</span>
  ) : null;

  switch (spec.kind) {
    case 'group': {
      // short numbers side by side once there is room; anything else one per line
      const numbers = spec.fields.every((f) => isNumber(f.spec));
      return (
        <div
          className={cn(
            'grid gap-3',
            numbers && 'sm:grid-cols-2 sm:items-end',
            path.length > 0 && 'border-l border-border-strong pl-3.5',
          )}
        >
          {spec.fields.map((f) => {
            const p = [...path, f.name];
            const label = meta.fields?.[pathKey(p)]
              ? pick(meta.fields[pathKey(p)] as Bilingual, meta.language)
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
    }
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
                  ? pick(meta.optionLabels[o] as Bilingual, meta.language)
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
            className="w-full rounded-button bg-field px-3.5 py-2.5 font-mono text-base shadow-[inset_0_0_0_1px_var(--hairline-strong)] pointer-fine:text-[13px]"
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
              // a phone's number pad has no comma or space to separate entries
              inputMode="text"
              enterKeyHint="done"
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
      const leaf = spec.kind === 'nullable' ? spec.inner : spec;
      // the phone keypad that can type the value: digits, digits and a decimal mark, or (for a
      // number that may be negative, like a group id) the full keyboard, which has the minus
      const keypad =
        (leaf.kind !== 'integer' && leaf.kind !== 'number') ||
        leaf.min === undefined ||
        leaf.min < 0
          ? 'text'
          : leaf.kind === 'integer'
            ? 'numeric'
            : 'decimal';
      // nine digits, or 604800 seconds, are hard to read in a field: say it as people would
      const kind = meta.unitKind;
      const typed =
        !invalid && (kind === 'sum' || kind === 'seconds' || kind === 'ms')
          ? fromDraft(spec, draft)
          : null;
      const readout =
        typeof typed !== 'number' || !Number.isFinite(typed)
          ? null
          : kind === 'sum'
            ? Number.isSafeInteger(typed) && Math.abs(typed) >= 10_000
              ? formatMoney(typed, meta.language)
              : null
            : durationText(typed, kind as 'seconds' | 'ms', meta.language, meta.t);
      return (
        <div>
          <div className="flex items-center gap-2">
            <Input
              id={id}
              {...aria}
              autoComplete="off"
              inputMode={keypad}
              enterKeyHint="done"
              placeholder={spec.kind === 'nullable' ? meta.t.settings.notSet : undefined}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              value={String(draft)}
              onChange={(e) => onChange(e.target.value)}
            />
            {unit}
          </div>
          {readout && (
            <p className="mt-1.5 text-small text-muted-foreground tabular-nums">{readout}</p>
          )}
          <Issues meta={meta} path={path} />
        </div>
      );
    }
  }
}
