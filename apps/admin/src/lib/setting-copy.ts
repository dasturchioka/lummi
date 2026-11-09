import {
  settingDefinitions,
  utcToTashkent,
  type InputSpec,
  type Localized,
  type SettingIssue,
  type SettingKey,
} from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import type { AdminMessages } from './i18n';
import { fill } from './utils';

export const pick = (l: Localized, language: Language) => l[language];

/** `10.11.2026 14:05`, Asia/Tashkent, from a UTC instant (the shared helper, never the browser's zone). */
export function formatTashkent(iso: string): string {
  const d = utcToTashkent(new Date(iso));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.day)}.${p(d.month)}.${d.year} ${p(d.hour)}:${p(d.minute)}`;
}

export function issueMessage(t: AdminMessages, issue: SettingIssue): string {
  const s = t.settings.issues;
  switch (issue.code) {
    case 'too_small':
      return fill(issue.exclusive ? s.too_small_exclusive : s.too_small, {
        min: String(issue.min),
      });
    case 'too_big':
      return fill(issue.exclusive ? s.too_big_exclusive : s.too_big, { max: String(issue.max) });
    case 'too_few_items':
      return fill(s.too_few_items, { min: String(issue.min) });
    default:
      return s[issue.code];
  }
}

/** The number's bounds as one sentence, or null when there are none worth showing. */
export function rangeText(t: AdminMessages, spec: InputSpec): string | null {
  const inner = spec.kind === 'nullable' ? spec.inner : spec;
  if (inner.kind !== 'integer' && inner.kind !== 'number') return null;
  const { min, max } = inner;
  if (min !== undefined && max !== undefined) {
    return fill(t.settings.range, { min: String(min), max: String(max) });
  }
  if (min !== undefined) return fill(t.settings.rangeMin, { min: String(min) });
  if (max !== undefined) return fill(t.settings.rangeMax, { max: String(max) });
  return null;
}

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** A stored value as a readable line (for "default" and the like). */
export function displayValue(
  key: SettingKey,
  spec: InputSpec,
  value: unknown,
  language: Language,
  t: AdminMessages,
  path: string[] = [],
): string {
  const meta = settingDefinitions[key] as {
    unit?: keyof AdminMessages['settings']['units'];
    fields?: Record<string, Localized>;
    optionLabels?: Record<string, Localized>;
  };
  const unit =
    meta.unit && meta.unit !== 'none' && meta.unit !== 'ratio'
      ? ` ${t.settings.units[meta.unit]}`
      : '';
  const inner = spec.kind === 'nullable' ? spec.inner : spec;
  if (value === null || value === undefined) return t.settings.notSet;
  switch (inner.kind) {
    case 'boolean':
      return value ? t.settings.on : t.settings.off;
    case 'integer':
    case 'number':
      return `${typeof value === 'number' && Number.isInteger(value) ? group(value) : String(value)}${unit}`;
    case 'enum':
      return meta.optionLabels?.[String(value)]?.[language] ?? String(value);
    case 'text':
      return String(value);
    case 'list':
      return Array.isArray(value) && value.length > 0
        ? value.map(String).join(', ') + unit
        : t.settings.notSet;
    case 'group': {
      const obj = value as Record<string, unknown>;
      return inner.fields
        .map((f) => {
          const p = [...path, f.name];
          const label = meta.fields?.[p.join('.')]?.[language] ?? f.name;
          return f.spec.kind === 'group'
            ? `${label} (${displayValue(key, f.spec, obj[f.name], language, t, p)})`
            : `${label}: ${displayValue(key, f.spec, obj[f.name], language, t, p)}`;
        })
        .join('; ');
    }
    case 'json':
      return JSON.stringify(value);
  }
}
