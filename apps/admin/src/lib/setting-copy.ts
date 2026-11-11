import {
  settingMeta,
  utcToTashkent,
  type Bilingual,
  type SettingIssue,
  type SettingKey,
} from '@lummi/contracts';
import { formatMoney, plural, type Language } from '@lummi/i18n';
import type { AdminMessages } from './i18n';
import type { InputSpec } from './setting-input';
import { fill } from './utils';

export const pick = (l: Bilingual, language: Language) => l[language];

/**
 * `10.11.2026 14:05`, Asia/Tashkent, from a UTC instant (the shared helper, never the browser's
 * zone). A no-break space keeps the time on the line of its date.
 */
export function formatTashkent(iso: string): string {
  const d = utcToTashkent(new Date(iso));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.day)}.${p(d.month)}.${d.year}\u00a0${p(d.hour)}:${p(d.minute)}`;
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
    case 'feed_guard_too_long':
      return fill(s.feed_guard_too_long, { max: String(issue.max) });
    case 'wait_too_short':
      return fill(s.wait_too_short, { min: String(issue.min) });
    default:
      return s[issue.code];
  }
}

/**
 * Digits in groups of three with narrow no-break spaces, as `formatMoney` groups them, and the
 * decimal comma («1,5»), for any plain number.
 */
export const num = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, '\u202f');

/**
 * The number's bounds as one sentence, or null when there are none. "Greater than 10" stays
 * "greater than". The unit goes on the last bound, which reads right in both languages («от 0 до
 * 100 000 000 сум», «0 dan 100 000 000 soʻm gacha»); so'm through `formatMoney`.
 */
export function rangeText(
  t: AdminMessages,
  spec: InputSpec,
  key?: SettingKey,
  language: Language = 'ru',
): string | null {
  const inner = spec.kind === 'nullable' ? spec.inner : spec;
  if (inner.kind !== 'integer' && inner.kind !== 'number') return null;
  const bounds: { template: string; slot: 'min' | 'max'; value: number }[] = [];
  if (inner.min !== undefined) {
    const template = inner.minExclusive ? t.settings.rangeMinExclusive : t.settings.rangeMin;
    bounds.push({ template, slot: 'min', value: inner.min });
  }
  if (inner.max !== undefined) {
    const template = inner.maxExclusive ? t.settings.rangeMaxExclusive : t.settings.rangeMax;
    bounds.push({ template, slot: 'max', value: inner.max });
  }
  if (bounds.length === 0) return null;
  const unit = key ? settingMeta(key).unit : undefined;
  const suffix = key ? unitText(key, t) : null;
  const parts = bounds.map((b, i) => {
    const last = i === bounds.length - 1;
    const shown =
      last && unit === 'sum' && Number.isSafeInteger(b.value)
        ? formatMoney(b.value, language)
        : last && suffix
          ? `${num(b.value)}\u00a0${suffix}`
          : num(b.value);
    return fill(b.template, { [b.slot]: shown });
  });
  return fill(t.settings.allowed, { parts: parts.join(' ') });
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
      return `${num(value)}${suffix.replace(' ', '\u00a0')}`;
    case 'enum':
      return meta.optionLabels?.[String(value)]?.[language] ?? String(value);
    case 'text':
      return String(value);
    case 'list':
      return Array.isArray(value) && value.length > 0
        ? value.map(String).join(', ') + suffix
        : t.settings.notSet;
    case 'group':
      // a nested group's parts go in brackets with commas, the outer ones with « · », so a
      // bracket never meets a semicolon («…до скидки) · Промокод»)
      return groupParts(key, inner, value, language, t, path).join(path.length ? ', ' : ' · ');
    case 'json':
      return JSON.stringify(value);
  }
}

/** A group's parts as «Label: value» (a nested group as «Label (a: x, b: y)»), one per field. */
export function groupParts(
  key: SettingKey,
  spec: Extract<InputSpec, { kind: 'group' }>,
  value: unknown,
  language: Language,
  t: AdminMessages,
  path: string[] = [],
): string[] {
  const meta = settingMeta(key);
  const obj = (value ?? {}) as Record<string, unknown>;
  return spec.fields.map((f) => {
    const p = [...path, f.name];
    const label = meta.fields?.[p.join('.')]?.[language] ?? f.name;
    const shown = displayValue(key, f.spec, obj[f.name], language, t, p);
    return f.spec.kind === 'group' ? `${label} (${shown})` : `${label}: ${shown}`;
  });
}

const DURATION_UNITS = [
  ['days', 86_400],
  ['hours', 3_600],
  ['minutes', 60],
  ['seconds', 1],
] as const;

/**
 * A duration field read back for people: the largest whole unit («= 7 дней», «= 20 секунд»), or,
 * when no single unit is exact, every part («= 1 ч 30 мин»). Null where it would only repeat the
 * field (under a minute of seconds) or the value is not a whole number of seconds.
 */
export function durationText(
  value: number,
  unit: 'seconds' | 'ms',
  language: Language,
  t: AdminMessages,
): string | null {
  const total = unit === 'ms' ? value / 1000 : value;
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  if (unit === 'seconds' && total < 60) return null;
  const d = t.settings.duration;
  const [name, size] = DURATION_UNITS.find(([, s]) => total >= s) ?? DURATION_UNITS[3];
  if (total % size === 0) return `= ${plural(language, total / size, d[name])}`;
  let rest = total;
  const parts: string[] = [];
  for (const [part, s] of DURATION_UNITS) {
    const n = Math.floor(rest / s);
    if (n > 0) parts.push(`${n}\u00a0${d.short[part]}`);
    rest -= n * s;
  }
  return `= ${parts.join(' ')}`;
}
