import {
  settingMeta,
  utcToTashkent,
  type Bilingual,
  type SettingIssue,
  type SettingKey,
} from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import type { AdminMessages } from './i18n';
import type { InputSpec } from './setting-input';
import { fill } from './utils';

export const pick = (l: Bilingual, language: Language) => l[language];

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

/** Digits in groups of three with the language's separator, for any plain number. */
const num = (n: number) => n.toLocaleString('ru-RU');

/** The number's bounds as one sentence, or null when there are none. "Greater than 10" stays "greater than". */
export function rangeText(t: AdminMessages, spec: InputSpec): string | null {
  const inner = spec.kind === 'nullable' ? spec.inner : spec;
  if (inner.kind !== 'integer' && inner.kind !== 'number') return null;
  const parts: string[] = [];
  if (inner.min !== undefined) {
    const key = inner.minExclusive ? t.settings.rangeMinExclusive : t.settings.rangeMin;
    parts.push(fill(key, { min: num(inner.min) }));
  }
  if (inner.max !== undefined) {
    const key = inner.maxExclusive ? t.settings.rangeMaxExclusive : t.settings.rangeMax;
    parts.push(fill(key, { max: num(inner.max) }));
  }
  return parts.length ? fill(t.settings.allowed, { parts: parts.join(' ') }) : null;
}

/** The unit written after a number, or null when the setting has none (a ratio is explained by its hint). */
export function unitText(key: SettingKey, t: AdminMessages): string | null {
  const unit = settingMeta(key).unit;
  return unit && unit !== 'none' && unit !== 'ratio' ? t.settings.units[unit] : null;
}

/** A stored value as a readable line (for "default", the audit page and the like). */
export function displayValue(
  key: SettingKey,
  spec: InputSpec,
  value: unknown,
  language: Language,
  t: AdminMessages,
  path: string[] = [],
): string {
  const meta = settingMeta(key);
  const suffix = unitText(key, t) ? ` ${unitText(key, t)}` : '';
  const inner = spec.kind === 'nullable' ? spec.inner : spec;
  if (value === null || value === undefined) return t.settings.notSet;
  switch (inner.kind) {
    case 'boolean':
      return value ? t.settings.on : t.settings.off;
    case 'integer':
    case 'number':
      if (typeof value !== 'number') return String(value);
      if (meta.unit === 'sum' && Number.isSafeInteger(value)) return formatMoney(value, language);
      return `${num(value)}${suffix}`;
    case 'enum':
      return meta.optionLabels?.[String(value)]?.[language] ?? String(value);
    case 'text':
      return String(value);
    case 'list':
      return Array.isArray(value) && value.length > 0
        ? value.map(String).join(', ') + suffix
        : t.settings.notSet;
    case 'group': {
      const obj = value as Record<string, unknown>;
      return inner.fields
        .map((f) => {
          const p = [...path, f.name];
          const label = meta.fields?.[p.join('.')]?.[language] ?? f.name;
          const shown = displayValue(key, f.spec, obj[f.name], language, t, p);
          return f.spec.kind === 'group' ? `${label} (${shown})` : `${label}: ${shown}`;
        })
        .join('; ');
    }
    case 'json':
      return JSON.stringify(value);
  }
}
